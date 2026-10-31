import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { DbService } from '../../common/db.service';
import { workDateOf } from '../../common/tz';
import { AuthUser } from '../../auth/roles';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { NotificationsService } from '../../notifications/notifications.service';
import { OfficeService } from '../office/office.service';

@Injectable()
export class MeService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly office: OfficeService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** What the employee's attendance screen needs: mode, today's office record, or live agent status. */
  async today(user: AuthUser) {
    const now = this.clock.now();
    const date = workDateOf(now, this.cfg.timezone);
    if (user.workMode === 'office') return { mode: 'office' as const, ...(await this.office.today(user)) };

    const s = (await this.db.query(`SELECT id, started_at, state, last_heartbeat_at FROM remote_sessions WHERE user_id = $1 AND ended_at IS NULL`, [user.id])).rows[0];
    const devices = (await this.db.query('SELECT count(*)::int AS n FROM devices WHERE user_id = $1 AND revoked_at IS NULL', [user.id])).rows[0].n;
    const fresh = s && now.getTime() - new Date(s.lastHeartbeatAt).getTime() < this.cfg.agentOfflineSeconds * 1000;
    return {
      mode: 'remote' as const,
      date,
      enrolledDevices: devices,
      idleMinutes: this.cfg.idleMinutes,
      session: s
        ? {
            id: s.id,
            startedAt: s.startedAt,
            state: s.state,
            lastHeartbeatAt: s.lastHeartbeatAt,
            // The live indicator: true only while the agent is reporting and the person isn't marked away.
            trackingActive: Boolean(fresh) && (s.state === 'active' || s.state === 'prompted'),
          }
        : null,
    };
  }

  /** One day of timeline for a person: sessions, their periods with durations, totals and flags. */
  async activity(userId: string, date: string) {
    const now = this.clock.now();
    const sessions = (await this.db.query('SELECT id, started_at, ended_at, end_reason, state FROM remote_sessions WHERE user_id = $1 AND work_date = $2 ORDER BY started_at', [userId, date])).rows;
    const ids = sessions.map((s) => s.id);
    const periods = ids.length
      ? (await this.db.query('SELECT id, session_id, kind, started_at, ended_at FROM activity_periods WHERE session_id = ANY($1) ORDER BY started_at', [ids])).rows
      : [];
    const flags = ids.length
      ? (await this.db.query(
          `SELECT id, period_id, kind, severity, status, created_at, resolution_note, employee_note FROM review_flags WHERE session_id = ANY($1) ORDER BY created_at`,
          [ids],
        )).rows
      : [];

    const totals = { activeSeconds: 0, idleSeconds: 0, absentSeconds: 0, offlineSeconds: 0 };
    const withSeconds = periods.map((p) => {
      const seconds = Math.max(0, Math.round(((p.endedAt ? new Date(p.endedAt) : now).getTime() - new Date(p.startedAt).getTime()) / 1000));
      totals[`${p.kind}Seconds` as keyof typeof totals] += seconds;
      return { ...p, seconds };
    });
    return {
      date,
      totals,
      sessions: sessions.map((s) => ({ ...s, periods: withSeconds.filter((p) => p.sessionId === s.id) })),
      flags,
    };
  }

  /** The employee's side of a flag: a reading break, a call, a meeting. Managers are told so they see it with the flag. */
  async addNote(user: AuthUser, flagId: string, text: string) {
    const f = (await this.db.query('SELECT id, user_id, status FROM review_flags WHERE id = $1', [flagId])).rows[0];
    if (!f || f.userId !== user.id) throw new NotFoundException();
    if (f.status !== 'open') throw new ForbiddenException('This flag has already been reviewed.');
    await this.db.tx(async (q) => {
      await q.query('UPDATE review_flags SET employee_note = $2, employee_note_at = $3 WHERE id = $1', [flagId, text, this.clock.now()]);
      await this.notifications.notifyManagersOf(q, user.id, 'flag_explained', `${user.name} (${user.orgId}) added an explanation to a flagged period.`, flagId);
    });
  }
}
