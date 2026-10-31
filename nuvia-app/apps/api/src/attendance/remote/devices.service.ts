import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import { AuthUser } from '../../auth/roles';
import { Clock } from '../../common/clock';
import { DbService, Q } from '../../common/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';

export interface DeviceAuthRecord {
  id: string;
  userId: string;
  secret: string;
  revokedAt: Date | null;
  user: AuthUser;
  userActive: boolean;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.cfg.deviceSecretKey, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }

  private decrypt(enc: string): string {
    const buf = Buffer.from(enc, 'base64');
    const d = createDecipheriv('aes-256-gcm', this.cfg.deviceSecretKey, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  }

  /** Registers a desktop agent install. The secret is returned once and never shown again. */
  async enroll(user: AuthUser, name: string) {
    if (user.workMode !== 'remote') throw new ForbiddenException('Only remote-mode accounts use the desktop agent.');
    const active = (await this.db.query('SELECT count(*)::int AS n FROM devices WHERE user_id = $1 AND revoked_at IS NULL', [user.id])).rows[0].n;
    if (active >= this.cfg.maxDevicesPerUser) {
      throw new ConflictException(`You already have ${active} enrolled devices. Revoke one first.`);
    }
    const secret = randomBytes(32).toString('hex');
    const { rows } = await this.db.query('INSERT INTO devices (user_id, name, secret_enc, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [
      user.id,
      name,
      this.encrypt(secret),
      this.clock.now(),
    ]);
    await this.audit.record(user.id, 'device.enroll', { type: 'device', id: rows[0].id }, { name });
    return { deviceId: rows[0].id as string, secret };
  }

  async list(userId: string) {
    return (await this.db.query('SELECT id, name, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = $1 ORDER BY created_at DESC', [userId])).rows;
  }

  async revoke(actor: AuthUser, deviceId: string) {
    const { rows } = await this.db.query('SELECT id, user_id FROM devices WHERE id = $1', [deviceId]);
    const d = rows[0];
    if (!d || (d.userId !== actor.id && actor.role !== 'hr_admin')) throw new NotFoundException();
    await this.db.tx(async (q) => {
      await q.query('UPDATE devices SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [deviceId, this.clock.now()]);
      await this.audit.record(actor.id, 'device.revoke', { type: 'device', id: deviceId }, { owner: d.userId }, q);
    });
  }

  async loadForAuth(deviceId: string): Promise<DeviceAuthRecord | null> {
    const { rows } = await this.db.query(
      `SELECT d.id, d.user_id, d.secret_enc, d.revoked_at,
              u.org_id, u.name, u.role, u.work_mode, u.manager_id, u.active
       FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = $1`,
      [deviceId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      userId: r.userId,
      secret: this.decrypt(r.secretEnc),
      revokedAt: r.revokedAt,
      userActive: r.active && r.workMode === 'remote',
      user: { id: r.userId, orgId: r.orgId, name: r.name, role: r.role, workMode: r.workMode, managerId: r.managerId },
    };
  }

  /**
   * Accepts a request number only if it is higher than every one seen before. This is what stops a
   * captured signed request from being replayed. Runs inside the caller's transaction.
   */
  async consumeSeq(q: Q, deviceId: string, seq: number, now: Date): Promise<void> {
    const r = await q.query('UPDATE devices SET last_seq = $2, last_seen_at = $3 WHERE id = $1 AND last_seq < $2', [deviceId, seq, now]);
    if (!r.rowCount) throw new ConflictException('Request number already used or out of order');
  }
}
