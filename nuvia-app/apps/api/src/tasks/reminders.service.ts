import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DbService } from '../common/db.service';
import { workDateOf } from '../common/tz';
import { APP_CONFIG, AppConfig } from '../config/config';
import { NotificationsService } from '../notifications/notifications.service';
import { addDays } from './tasks.service';

/** Sends one "due soon" and one "overdue" notification per task to its assignee. */
@Injectable()
export class RemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('TaskReminders');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly notes: NotificationsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (!this.cfg.schedulerEnabled) return;
    this.timer = setInterval(() => void this.run(), 5 * 60_000);
    this.timer.unref();
    void this.run();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n) this.log.log(`sent ${n} due-date reminders`);
    } catch (err) {
      this.log.error(`reminders failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Marks and notifies in one transaction, so a task is never reminded twice even if two ticks overlap. */
  async tick(now: Date = this.clock.now()): Promise<number> {
    const today = workDateOf(now, this.cfg.timezone);
    const soonEnd = addDays(today, this.cfg.dueSoonDays);
    return this.db.tx(async (q) => {
      const open = `t.status <> 'done' AND t.assignee_id IS NOT NULL AND p.archived_at IS NULL AND t.project_id = p.id`;
      const overdue = (
        await q.query(
          `UPDATE tasks t SET overdue_notified_at = $1 FROM projects p
           WHERE ${open} AND t.due_date < $2 AND t.overdue_notified_at IS NULL
           RETURNING t.id, t.assignee_id, t.title, t.number, t.due_date, p.key AS project_key`,
          [now, today],
        )
      ).rows;
      const soon = (
        await q.query(
          `UPDATE tasks t SET due_soon_notified_at = $1 FROM projects p
           WHERE ${open} AND t.due_date >= $2 AND t.due_date <= $3 AND t.due_soon_notified_at IS NULL
           RETURNING t.id, t.assignee_id, t.title, t.number, t.due_date, p.key AS project_key`,
          [now, today, soonEnd],
        )
      ).rows;
      for (const t of overdue) {
        await this.notes.notifyUsers(q, [t.assigneeId], 'task_overdue', `${t.projectKey}-${t.number}: ${t.title} was due ${t.dueDate} and is not done`, { taskId: t.id });
      }
      for (const t of soon) {
        await this.notes.notifyUsers(q, [t.assigneeId], 'task_due_soon', `${t.projectKey}-${t.number}: ${t.title} is due ${t.dueDate === today ? 'today' : t.dueDate}`, { taskId: t.id });
      }
      return overdue.length + soon.length;
    });
  }
}
