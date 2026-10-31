import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DbService, Q } from '../common/db.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { loadMilestones } from './goal-queries';
import { HealthService } from './health.service';
import { MeasureKey } from './health';

export interface Alert {
  key: string;
  kind: 'revenue' | 'margin' | 'runway' | 'milestone_overdue' | 'milestone_at_risk';
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  /** Page in the portal to look at. */
  link: string;
  /** Who besides the executives should hear about it (a milestone's owner). */
  alsoNotify: string | null;
}

export interface AlertRow extends Omit<Alert, 'alsoNotify'> {
  raisedAt: string;
}

const MEASURE_TITLE: Partial<Record<MeasureKey, { kind: Alert['kind']; title: string; link: string }>> = {
  revenue: { kind: 'revenue', title: 'Revenue is behind plan', link: '/leadership/revenue' },
  margin: { kind: 'margin', title: 'Margin is below plan', link: '/leadership/revenue' },
  runway: { kind: 'runway', title: 'Cash runway is short', link: '/leadership/revenue' },
};

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Keeps the list of things that are off track (revenue, margin, runway, and individual milestones) and tells the
 * executives once when each one appears, and again only if it gets worse or comes back after being fixed.
 */
@Injectable()
export class AlertsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('LeadershipAlerts');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly health: HealthService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (!this.cfg.schedulerEnabled) return;
    this.timer = setInterval(() => void this.safeSync(), 5 * 60_000);
    this.timer.unref();
    void this.safeSync();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeSync() {
    if (this.running) return;
    this.running = true;
    try {
      await this.sync();
    } catch (err) {
      this.log.error(`alert check failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** What is off track right now, worked out from the data. Nothing is written. */
  async compute(q: Q = this.db): Promise<Alert[]> {
    const h = await this.health.evaluate(q);
    const today = this.health.today();
    const out: Alert[] = [];
    for (const m of h.measures) {
      const meta = MEASURE_TITLE[m.key];
      if (!meta || (m.status !== 'at_risk' && m.status !== 'off_track')) continue;
      out.push({ key: `measure:${m.key}`, kind: meta.kind, severity: m.status === 'off_track' ? 'critical' : 'warning', title: meta.title, detail: m.summary, link: meta.link, alsoNotify: null });
    }
    for (const ms of await loadMilestones(q, today, h.rules)) {
      if (ms.goalStatus !== 'active') continue;
      if (ms.state === 'overdue') {
        out.push({
          key: `milestone:${ms.id}:overdue`, kind: 'milestone_overdue', severity: 'critical', title: `Milestone overdue: ${ms.title}`,
          detail: `${ms.goalTitle}. It was due ${fmtDay(ms.dueDate)}, ${-ms.daysLeft} day${ms.daysLeft === -1 ? '' : 's'} ago.`, link: `/leadership/goals/${ms.goalId}`, alsoNotify: ms.ownerId,
        });
      } else if (ms.state === 'at_risk') {
        out.push({
          key: `milestone:${ms.id}:at_risk`, kind: 'milestone_at_risk', severity: 'warning', title: `Milestone at risk: ${ms.title}`,
          detail: `${ms.goalTitle}. Due ${fmtDay(ms.dueDate)} and only ${ms.tasksDone} of ${ms.tasksTotal} linked tasks are done.`, link: `/leadership/goals/${ms.goalId}`, alsoNotify: ms.ownerId,
        });
      }
    }
    return out;
  }

  /**
   * Brings the stored alerts in line with the data and notifies for new or worsened ones. Safe to call from anywhere
   * and as often as you like: it runs under a lock, and an alert that was already announced stays quiet.
   * Returns the alerts that are currently open, worst first.
   */
  async sync(): Promise<AlertRow[]> {
    const now = this.clock.now();
    return this.db.tx(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock(727002)');
      const current = await this.compute(q);
      const stored = new Map((await q.query('SELECT * FROM leadership_alerts')).rows.map((r) => [r.key as string, r]));
      const execs = (await q.query(`SELECT id FROM users WHERE role = 'executive' AND active`)).rows.map((r) => r.id as string);
      const seen = new Set<string>();

      for (const a of current) {
        seen.add(a.key);
        const prev = stored.get(a.key);
        const reopened = !prev || prev.resolvedAt !== null;
        const worse = !reopened && a.severity === 'critical' && prev.notifiedSeverity === 'warning';
        const raisedAt = reopened ? now : prev.raisedAt;
        await q.query(
          `INSERT INTO leadership_alerts (key, kind, severity, title, detail, link, raised_at, last_seen_at, resolved_at, notified_severity)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL)
           ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, severity = EXCLUDED.severity, title = EXCLUDED.title, detail = EXCLUDED.detail,
             link = EXCLUDED.link, raised_at = EXCLUDED.raised_at, last_seen_at = EXCLUDED.last_seen_at, resolved_at = NULL,
             notified_severity = CASE WHEN $9::boolean THEN NULL ELSE leadership_alerts.notified_severity END`,
          [a.key, a.kind, a.severity, a.title, a.detail, a.link, raisedAt, now, reopened],
        );
        if (reopened || worse) {
          const owner = a.alsoNotify ? (await q.query('SELECT id FROM users WHERE id = $1 AND active', [a.alsoNotify])).rows.map((r) => r.id as string) : [];
          const message = `${a.severity === 'critical' ? 'Off track' : 'At risk'}: ${a.title}. ${a.detail}`;
          const now2 = this.clock.now();
          for (const id of new Set([...execs, ...owner])) {
            // Only executives can open the leadership pages, so only they get the link.
            await q.query('INSERT INTO notifications (user_id, kind, message, link, created_at) VALUES ($1,$2,$3,$4,$5)', [id, 'leadership_alert', message, execs.includes(id) ? a.link : null, now2]);
          }
          await q.query('UPDATE leadership_alerts SET notified_severity = $2 WHERE key = $1', [a.key, a.severity]);
        }
      }
      // Anything stored as open that is no longer true has been fixed.
      for (const [key, row] of stored) {
        if (!seen.has(key) && row.resolvedAt === null) {
          await q.query('UPDATE leadership_alerts SET resolved_at = $2, notified_severity = NULL WHERE key = $1', [key, now]);
        }
      }
      const open = await q.query(
        `SELECT key, kind, severity, title, detail, link, raised_at FROM leadership_alerts WHERE resolved_at IS NULL
         ORDER BY (severity = 'critical') DESC, raised_at`,
      );
      return open.rows.map((r) => ({ key: r.key, kind: r.kind, severity: r.severity, title: r.title, detail: r.detail, raisedAt: new Date(r.raisedAt).toISOString(), link: r.link }));
    });
  }
}
