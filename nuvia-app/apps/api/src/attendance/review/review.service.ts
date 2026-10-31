import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { AuthUser } from '../../auth/roles';
import { Clock } from '../../common/clock';
import { DbService } from '../../common/db.service';

export interface FlagFilters {
  status?: string;
  userId?: string;
  severity?: string;
  limit: number;
}

@Injectable()
export class ReviewService {
  constructor(private readonly db: DbService, private readonly clock: Clock, private readonly audit: AuditService) {}

  /** Leads see their direct reports. HR/admin and executives see everyone. */
  async canView(viewer: AuthUser, subjectUserId: string): Promise<boolean> {
    if (viewer.role === 'hr_admin' || viewer.role === 'executive') return true;
    if (viewer.role !== 'team_lead') return false;
    const r = await this.db.query('SELECT 1 FROM users WHERE id = $1 AND manager_id = $2', [subjectUserId, viewer.id]);
    return r.rowCount > 0;
  }

  async assertCanView(viewer: AuthUser, subjectUserId: string) {
    // 404 rather than 403 so the existence of other teams' flags isn't revealed.
    if (!(await this.canView(viewer, subjectUserId))) throw new NotFoundException();
  }

  async list(viewer: AuthUser, f: FlagFilters) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (viewer.role === 'team_lead') add('u.manager_id = ?', viewer.id);
    if (f.status) add('fl.status = ?', f.status);
    if (f.userId) add('fl.user_id = ?', f.userId);
    if (f.severity) add('fl.severity = ?', f.severity);
    params.push(f.limit);
    const { rows } = await this.db.query(
      `SELECT fl.id, fl.kind, fl.severity, fl.status, fl.detail, fl.created_at, fl.resolved_at, fl.resolution_note, fl.employee_note,
              u.id AS user_id, u.org_id, u.name,
              p.kind AS period_kind, p.started_at AS period_started_at, p.ended_at AS period_ended_at
       FROM review_flags fl JOIN users u ON u.id = fl.user_id LEFT JOIN activity_periods p ON p.id = fl.period_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (fl.status = 'open') DESC, fl.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  async detail(viewer: AuthUser, id: string) {
    const fl = (
      await this.db.query(
        `SELECT fl.*, u.org_id, u.name, r.name AS resolved_by_name FROM review_flags fl
         JOIN users u ON u.id = fl.user_id LEFT JOIN users r ON r.id = fl.resolved_by WHERE fl.id = $1`,
        [id],
      )
    ).rows[0];
    if (!fl) throw new NotFoundException();
    await this.assertCanView(viewer, fl.userId);

    const periods = fl.sessionId ? (await this.db.query('SELECT id, kind, started_at, ended_at FROM activity_periods WHERE session_id = $1 ORDER BY started_at', [fl.sessionId])).rows : [];
    const prompts = fl.sessionId
      ? (await this.db.query('SELECT id, kind, status, attempts, created_at, deadline_at, answered_at FROM prompts WHERE session_id = $1 ORDER BY created_at', [fl.sessionId])).rows
      : [];
    // Summary only. Raw per-heartbeat data stays out of the review screen.
    const hb = fl.sessionId
      ? (
          await this.db.query(
            `SELECT count(*)::int AS heartbeats, COALESCE(sum(active_seconds),0)::int AS active_seconds, COALESCE(sum(other_input_events),0)::int AS other_input_events
             FROM heartbeats WHERE session_id = $1`,
            [fl.sessionId],
          )
        ).rows[0]
      : null;
    await this.audit.record(viewer.id, 'flag.view', { type: 'review_flag', id }, { subject: fl.userId });
    return { flag: fl, periods, prompts, heartbeatSummary: hb };
  }

  /** Managers and HR decide. Executives are read-only by design. */
  async resolve(viewer: AuthUser, id: string, decision: 'confirmed' | 'dismissed' | 'excused', note: string) {
    const fl = (await this.db.query('SELECT user_id FROM review_flags WHERE id = $1', [id])).rows[0];
    if (!fl) throw new NotFoundException();
    await this.assertCanView(viewer, fl.userId);
    if (viewer.role === 'executive') throw new ForbiddenException();
    if (fl.userId === viewer.id) throw new ForbiddenException('You cannot review your own flag.');
    await this.db.tx(async (q) => {
      const r = await q.query(
        `UPDATE review_flags SET status = $2, resolution_note = $3, resolved_by = $4, resolved_at = $5 WHERE id = $1 AND status = 'open'`,
        [id, decision, note, viewer.id, this.clock.now()],
      );
      if (!r.rowCount) throw new ConflictException('This flag has already been reviewed.');
      await this.audit.record(viewer.id, 'flag.resolve', { type: 'review_flag', id }, { decision, subject: fl.userId }, q);
    });
  }
}
