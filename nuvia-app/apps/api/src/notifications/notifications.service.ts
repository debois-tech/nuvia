import { Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DbService, Q } from '../common/db.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService, private readonly clock: Clock) {}

  /** Notifies the person's manager, or every active HR/admin when they have none. Returns who was notified. */
  async notifyManagersOf(q: Q, userId: string, kind: string, message: string, flagId: string | null): Promise<string[]> {
    const { rows } = await q.query(
      'SELECT m.id FROM users u JOIN users m ON m.id = u.manager_id WHERE u.id = $1 AND m.active',
      [userId],
    );
    let recipients: string[] = rows.map((r) => r.id);
    if (!recipients.length) {
      recipients = (await q.query(`SELECT id FROM users WHERE role = 'hr_admin' AND active AND id <> $1`, [userId])).rows.map((r) => r.id);
    }
    const now = this.clock.now();
    for (const id of recipients) {
      await q.query('INSERT INTO notifications (user_id, kind, message, flag_id, created_at) VALUES ($1,$2,$3,$4,$5)', [id, kind, message, flagId, now]);
    }
    return recipients;
  }

  /** Adds one notification per recipient (duplicates removed). Pass `q` to join an open transaction. */
  async notifyUsers(q: Q, userIds: Iterable<string>, kind: string, message: string, link: { taskId?: string; flagId?: string }): Promise<string[]> {
    const recipients = [...new Set(userIds)];
    const now = this.clock.now();
    for (const id of recipients) {
      await q.query('INSERT INTO notifications (user_id, kind, message, flag_id, task_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
        id, kind, message, link.flagId ?? null, link.taskId ?? null, now,
      ]);
    }
    return recipients;
  }

  async list(userId: string, unreadOnly: boolean) {
    const { rows } = await this.db.query(
      `SELECT id, kind, message, flag_id, task_id, created_at, read_at FROM notifications
       WHERE user_id = $1 ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT 100`,
      [userId],
    );
    const unread = (await this.db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])).rows[0].n;
    return { unread, items: rows };
  }

  async markRead(userId: string, id: string) {
    const r = await this.db.query('UPDATE notifications SET read_at = $3 WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [id, userId, this.clock.now()]);
    if (!r.rowCount) {
      const exists = await this.db.query('SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2', [id, userId]);
      if (!exists.rowCount) throw new NotFoundException();
    }
  }

  async markAllRead(userId: string) {
    await this.db.query('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL', [userId, this.clock.now()]);
  }
}
