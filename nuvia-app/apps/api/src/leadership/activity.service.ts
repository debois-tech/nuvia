import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { APP_CONFIG, AppConfig } from '../config/config';

export interface Funnel {
  created: number;
  assigned: number;
  started: number;
  inReview: number;
  done: number;
}

export interface WeekdayCounts {
  /** Monday first. */
  byWeekday: number[];
  total: number;
}

export interface Activity {
  tasks: Funnel;
  completed: WeekdayCounts;
  checkIns: WeekdayCounts;
}

const nextMonth = (ym: string) => {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

/** Work done across the company in a range of months: the task funnel, tasks completed and check-ins by weekday. */
@Injectable()
export class ActivityService {
  constructor(private readonly db: DbService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async forRange(range: { from: string; to: string }): Promise<Activity> {
    const from = `${range.from}-01`;
    const toExcl = nextMonth(range.to);
    const tz = this.cfg.timezone;
    // Month bounds are in the company time zone.
    const bounds = `t.created_at >= ($1::date)::timestamp AT TIME ZONE $3 AND t.created_at < ($2::date)::timestamp AT TIME ZONE $3`;

    // A stage counts everything that reached it, so each step is no bigger than the one before.
    const f = (
      await this.db.query(
        `SELECT count(*)::int AS created,
                (count(*) FILTER (WHERE t.assignee_id IS NOT NULL OR t.status <> 'todo'))::int AS assigned,
                (count(*) FILTER (WHERE t.status <> 'todo'))::int AS started,
                (count(*) FILTER (WHERE t.status IN ('in_review', 'done')))::int AS in_review,
                (count(*) FILTER (WHERE t.status = 'done'))::int AS done
         FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.archived_at IS NULL AND ${bounds}`,
        [from, toExcl, tz],
      )
    ).rows[0] as Funnel;

    const weekdays = (rows: { dow: number; n: number }[]): WeekdayCounts => {
      const byWeekday = [0, 0, 0, 0, 0, 0, 0];
      for (const r of rows) byWeekday[r.dow - 1] = r.n;
      return { byWeekday, total: byWeekday.reduce((a, b) => a + b, 0) };
    };
    const completed = weekdays(
      (
        await this.db.query(
          `SELECT extract(isodow FROM (t.completed_at AT TIME ZONE $3))::int AS dow, count(*)::int AS n
           FROM tasks t JOIN projects p ON p.id = t.project_id
           WHERE p.archived_at IS NULL AND t.status = 'done' AND t.completed_at >= ($1::date)::timestamp AT TIME ZONE $3 AND t.completed_at < ($2::date)::timestamp AT TIME ZONE $3
           GROUP BY 1`,
          [from, toExcl, tz],
        )
      ).rows,
    );
    // One check-in per person per day, whether they came to the office or worked remotely.
    const checkIns = weekdays(
      (
        await this.db.query(
          `SELECT extract(isodow FROM d.work_date)::int AS dow, count(*)::int AS n
           FROM (SELECT user_id, work_date FROM office_attendance UNION SELECT user_id, work_date FROM remote_sessions) d
           WHERE d.work_date >= $1::date AND d.work_date < $2::date GROUP BY 1`,
          [from, toExcl],
        )
      ).rows,
    );
    return { tasks: { created: f.created, assigned: f.assigned, started: f.started, inReview: f.inReview, done: f.done }, completed, checkIns };
  }
}
