import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/roles';
import { Clock } from '../common/clock';
import { DbService } from '../common/db.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { TaskAccess } from './access.service';
import { TasksService } from './tasks.service';

const MAX_PER_TASK = 20;

/** Strips any path, control characters and quotes; keeps a readable name of bounded length. */
export function cleanFileName(raw: unknown): string {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const name = base.replace(/[\u0000-\u001f\u007f"<>|?*:]/g, '').replace(/^\.+/, '').trim().slice(0, 200);
  return name || 'file';
}

export function cleanContentType(raw: unknown): string {
  const t = String(raw ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][\w.+-]*\/[a-z0-9][\w.+-]*$/.test(t) && t.length <= 100 ? t : 'application/octet-stream';
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly access: TaskAccess,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private pathFor(key: string) {
    return join(this.cfg.uploadDir, key.slice(0, 2), key);
  }

  /**
   * Streams the request body straight to disk. There is no multipart parser: the browser sends the file as the
   * request body and the name in the query string. Size is enforced as bytes arrive.
   */
  async upload(user: AuthUser, taskId: string, body: Readable, declared: { name: unknown; type: unknown; length: number | null }) {
    const { task, access } = await this.tasks.load(user, taskId);
    if (!access.participate) throw new ForbiddenException();
    if (access.archived) throw new ConflictException('This project is archived. Unarchive it to make changes.');
    const max = this.cfg.maxUploadBytes;
    const mb = Math.round(max / 1024 / 1024);
    if (declared.length !== null && declared.length > max) {
      body.resume();
      throw new PayloadTooLargeException(`Files can be at most ${mb} MB`);
    }
    if (declared.length === 0) {
      body.resume();
      throw new BadRequestException('The file is empty');
    }
    const count = (await this.db.query('SELECT count(*)::int AS n FROM task_attachments WHERE task_id = $1 AND deleted_at IS NULL', [taskId])).rows[0].n;
    if (count >= MAX_PER_TASK) {
      body.resume();
      throw new ConflictException(`A task can hold at most ${MAX_PER_TASK} files`);
    }

    const key = randomUUID();
    const file = this.pathFor(key);
    const tmp = `${file}.part`;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    let size = 0;
    let tooLarge = false;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > max) {
          tooLarge = true;
          return cb(new Error('too large'));
        }
        cb(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, createWriteStream(tmp, { mode: 0o600, flags: 'wx' }));
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      if (tooLarge) throw new PayloadTooLargeException(`Files can be at most ${mb} MB`);
      throw new BadRequestException('The upload was interrupted');
    }
    if (size === 0) {
      await unlink(tmp).catch(() => undefined);
      throw new BadRequestException('The file is empty');
    }
    await rename(tmp, file);

    const name = cleanFileName(declared.name);
    const type = cleanContentType(declared.type);
    try {
      const id = await this.db.tx(async (q) => {
        const r = await q.query(
          `INSERT INTO task_attachments (task_id, uploader_id, file_name, content_type, size_bytes, storage_key, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [taskId, user.id, name, type, size, key, this.clock.now()],
        );
        await q.query('INSERT INTO task_activity (task_id, actor_id, kind, detail, created_at) VALUES ($1,$2,$3,$4,$5)', [
          taskId, user.id, 'attachment_added', JSON.stringify({ name, size }), this.clock.now(),
        ]);
        await this.audit.record(user.id, 'attachment.upload', { type: 'task', id: taskId }, { attachmentId: r.rows[0].id, name, size }, q);
        return r.rows[0].id as string;
      });
      return { id, fileName: name, contentType: type, sizeBytes: size, taskNumber: `${task.projectKey}-${task.number}` };
    } catch (err) {
      await unlink(file).catch(() => undefined);
      throw err;
    }
  }

  private async find(user: AuthUser, id: string) {
    const { rows } = await this.db.query('SELECT * FROM task_attachments WHERE id = $1 AND deleted_at IS NULL', [id]);
    const a = rows[0];
    if (!a) throw new NotFoundException();
    const { task, access } = await this.tasks.load(user, a.taskId);
    return { a, task, access };
  }

  async open(user: AuthUser, id: string) {
    const { a } = await this.find(user, id);
    const file = this.pathFor(a.storageKey);
    const st = await stat(file).catch(() => null);
    if (!st) throw new NotFoundException('The stored file is missing. Ask an admin to check the backups.');
    await this.audit.record(user.id, 'attachment.download', { type: 'task', id: a.taskId }, { attachmentId: id, name: a.fileName });
    return { name: a.fileName as string, type: a.contentType as string, size: st.size, stream: createReadStream(file) };
  }

  async remove(user: AuthUser, id: string) {
    const { a, access } = await this.find(user, id);
    if (!(access.manage || (access.participate && a.uploaderId === user.id))) throw new ForbiddenException();
    if (access.archived) throw new ConflictException('This project is archived. Unarchive it to make changes.');
    await this.db.tx(async (q) => {
      await q.query('UPDATE task_attachments SET deleted_at = $2 WHERE id = $1', [id, this.clock.now()]);
      await q.query('INSERT INTO task_activity (task_id, actor_id, kind, detail, created_at) VALUES ($1,$2,$3,$4,$5)', [
        a.taskId, user.id, 'attachment_removed', JSON.stringify({ name: a.fileName }), this.clock.now(),
      ]);
      await this.audit.record(user.id, 'attachment.delete', { type: 'task', id: a.taskId }, { attachmentId: id, name: a.fileName }, q);
    });
    // The row stays as a record; the bytes go.
    await unlink(this.pathFor(a.storageKey)).catch(() => undefined);
  }
}
