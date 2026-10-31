import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/roles';
import { Clock } from '../common/clock';
import { DbService, Q } from '../common/db.service';
import { workDateOf } from '../common/tz';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DEFAULT_RULES, evaluateFinance, evaluateMilestones, HealthRules, HealthRulesSchema, Measure, MonthTotals, overall } from './health';

const KEY = 'health_rules';

@Injectable()
export class HealthService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  today() {
    return workDateOf(this.clock.now(), this.cfg.timezone);
  }

  /** The rules in force and whether the leaders have saved (confirmed) them yet. Bad stored data falls back to the defaults. */
  async rules(q: Q = this.db): Promise<{ rules: HealthRules; confirmed: null | { by: string | null; at: string } }> {
    const { rows } = await q.query(
      `SELECT s.value, s.updated_at, u.name FROM leadership_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = $1`,
      [KEY],
    );
    const r = rows[0];
    if (!r) return { rules: DEFAULT_RULES, confirmed: null };
    const parsed = HealthRulesSchema.safeParse(r.value);
    if (!parsed.success) return { rules: DEFAULT_RULES, confirmed: null };
    return { rules: parsed.data, confirmed: { by: r.name ?? null, at: new Date(r.updatedAt).toISOString() } };
  }

  async saveRules(user: AuthUser, rules: HealthRules) {
    const before = (await this.rules()).rules;
    await this.db.tx(async (q) => {
      await q.query(
        `INSERT INTO leadership_settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [KEY, JSON.stringify(rules), user.id, this.clock.now()],
      );
      await this.audit.record(user.id, 'leadership.health_rules', { type: 'settings', id: KEY }, { before, after: rules }, q);
    });
    return this.rules();
  }

  /** Company-wide totals per month: the department rows added together. */
  async companyMonths(q: Q = this.db): Promise<MonthTotals[]> {
    const { rows } = await q.query(
      `SELECT period, sum(revenue)::float8 AS revenue, sum(target)::float8 AS target, sum(cost)::float8 AS cost,
              sum(cash_in)::float8 AS cash_in, sum(cash_out)::float8 AS cash_out, sum(closing_cash)::float8 AS closing_cash
       FROM finance_rows GROUP BY period ORDER BY period`,
    );
    return rows;
  }

  async milestoneCounts(q: Q = this.db): Promise<{ due: number; late: number }> {
    const { rows } = await q.query(
      `SELECT count(*) FILTER (WHERE m.due_date <= $1::date)::int AS due,
              count(*) FILTER (WHERE m.due_date <= $1::date AND m.done_at IS NULL)::int AS late
       FROM milestones m JOIN goals g ON g.id = m.goal_id WHERE g.status <> 'dropped'`,
      [this.today()],
    );
    return rows[0];
  }

  /** Revenue, margin, runway and milestone delivery, and the verdict across them. */
  async evaluate(q: Q = this.db) {
    const { rules, confirmed } = await this.rules(q);
    const fin = evaluateFinance(await this.companyMonths(q), rules, this.cfg.fiscalYearStartMonth);
    const milestones = evaluateMilestones(await this.milestoneCounts(q), rules);
    const measures: Measure[] = [fin.revenue, milestones, fin.margin, fin.runway];
    return { ...overall(measures), measures, asOf: fin.asOf, window: fin.window, rules, rulesConfirmed: confirmed };
  }
}
