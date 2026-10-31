import { z } from 'zod';

export type Status = 'on_track' | 'at_risk' | 'off_track';
export type MeasureStatus = Status | 'no_data';
export type MeasureKey = 'revenue' | 'milestones' | 'margin' | 'runway';

export interface MonthTotals {
  period: string; // 'YYYY-MM-01'
  revenue: number | null;
  target: number | null;
  cost: number | null;
  cashIn: number | null;
  cashOut: number | null;
  closingCash: number | null;
}

/**
 * The thresholds behind "on track / at risk / off track". The CEO, CTO and COO agree them and edit them in the
 * portal. The values below are PROPOSED DEFAULTS so the page works on day one; they mean nothing until the leaders
 * confirm them (the API reports whether anyone has).
 */
export interface HealthRules {
  /** Revenue as a percentage of target, this fiscal quarter so far. Higher is better. */
  revenue: { onTrackMin: number; atRiskMin: number };
  /** (revenue - cost) / revenue, this fiscal quarter so far, in percent. Higher is better. */
  margin: { onTrackMin: number; atRiskMin: number };
  /** Months of cash left at the recent burn rate. Higher is better. */
  runway: { onTrackMinMonths: number; atRiskMinMonths: number };
  milestones: {
    /** Share of milestones already due that are not done, in percent. Lower is better. */
    onTrackMaxLatePct: number;
    atRiskMaxLatePct: number;
    /** A milestone due within this many days is "at risk" while its linked work is below warnProgressBelowPct done. */
    warnDays: number;
    warnProgressBelowPct: number;
  };
}

export const DEFAULT_RULES: HealthRules = {
  revenue: { onTrackMin: 95, atRiskMin: 80 },
  margin: { onTrackMin: 20, atRiskMin: 10 },
  runway: { onTrackMinMonths: 12, atRiskMinMonths: 6 },
  milestones: { onTrackMaxLatePct: 10, atRiskMaxLatePct: 25, warnDays: 14, warnProgressBelowPct: 50 },
};

const num = (min: number, max: number) => z.number().finite().min(min).max(max);

export const HealthRulesSchema = z
  .object({
    revenue: z.object({ onTrackMin: num(0, 500), atRiskMin: num(0, 500) }).strict(),
    margin: z.object({ onTrackMin: num(-100, 100), atRiskMin: num(-100, 100) }).strict(),
    runway: z.object({ onTrackMinMonths: num(0, 240), atRiskMinMonths: num(0, 240) }).strict(),
    milestones: z
      .object({ onTrackMaxLatePct: num(0, 100), atRiskMaxLatePct: num(0, 100), warnDays: z.number().int().min(0).max(365), warnProgressBelowPct: num(0, 100) })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const bad = (path: string[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    if (r.revenue.atRiskMin > r.revenue.onTrackMin) bad(['revenue', 'atRiskMin'], 'At risk must not be above on track');
    if (r.margin.atRiskMin > r.margin.onTrackMin) bad(['margin', 'atRiskMin'], 'At risk must not be above on track');
    if (r.runway.atRiskMinMonths > r.runway.onTrackMinMonths) bad(['runway', 'atRiskMinMonths'], 'At risk must not be above on track');
    if (r.milestones.onTrackMaxLatePct > r.milestones.atRiskMaxLatePct) bad(['milestones', 'onTrackMaxLatePct'], 'On track must not be above at risk');
  });

export interface Measure {
  key: MeasureKey;
  label: string;
  status: MeasureStatus;
  /** The number the status was judged on (already rounded the way it is shown), or null. */
  value: number | null;
  unit: '%' | 'months' | '';
  /** Plain-English line, e.g. "Revenue is 82.4% of target (this quarter so far)". */
  summary: string;
  /** The rule in words, for the page. */
  rule: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const higher = (v: number, onTrack: number, atRisk: number): Status => (v >= onTrack ? 'on_track' : v >= atRisk ? 'at_risk' : 'off_track');
const lower = (v: number, onTrack: number, atRisk: number): Status => (v <= onTrack ? 'on_track' : v <= atRisk ? 'at_risk' : 'off_track');
const nz = (a: number | null): a is number => a !== null;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (period: string) => `${MONTH_NAMES[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

/** Fiscal year a month falls in, named by the calendar year it starts in. */
export function fiscalYearStart(period: string, startMonth: number): number {
  const y = Number(period.slice(0, 4));
  return Number(period.slice(5, 7)) >= startMonth ? y : y - 1;
}

/** 1-4 */
export function fiscalQuarter(period: string, startMonth: number): number {
  const m = Number(period.slice(5, 7));
  return Math.floor(((m - startMonth + 12) % 12) / 3) + 1;
}

export function fiscalQuarterLabel(period: string, startMonth: number): string {
  const q = fiscalQuarter(period, startMonth);
  const fy = fiscalYearStart(period, startMonth);
  return startMonth === 1 ? `Q${q} ${fy}` : `Q${q} FY${fy}-${String(fy + 1).slice(2)}`;
}

export function fiscalYearLabel(period: string, startMonth: number): string {
  const fy = fiscalYearStart(period, startMonth);
  return startMonth === 1 ? String(fy) : `FY${fy}-${String(fy + 1).slice(2)}`;
}

/** First month of the fiscal quarter containing `period`. */
export function quarterStart(period: string, startMonth: number): string {
  const m = Number(period.slice(5, 7));
  const back = ((m - startMonth + 12) % 12) % 3;
  let y = Number(period.slice(0, 4));
  let mm = m - back;
  if (mm < 1) {
    mm += 12;
    y -= 1;
  }
  return `${y}-${String(mm).padStart(2, '0')}-01`;
}

export interface FinanceMeasures {
  revenue: Measure;
  margin: Measure;
  runway: Measure;
  /** Latest month with revenue in the sheets, or null. */
  asOf: string | null;
  window: { from: string; to: string; label: string } | null;
}

const noData = (key: MeasureKey, label: string, summary: string, rule: string): Measure => ({ key, label, status: 'no_data', value: null, unit: key === 'runway' ? 'months' : '%', summary, rule });

export function revenueRule(r: HealthRules['revenue']) {
  return `On track at ${r.onTrackMin}% of target or more, at risk from ${r.atRiskMin}%, off track below that.`;
}
export function marginRule(r: HealthRules['margin']) {
  return `On track at ${r.onTrackMin}% margin or more, at risk from ${r.atRiskMin}%, off track below that.`;
}
export function runwayRule(r: HealthRules['runway']) {
  return `On track at ${r.onTrackMinMonths} months or more, at risk from ${r.atRiskMinMonths} months, off track below that. Not burning cash counts as on track.`;
}
export function milestoneRule(r: HealthRules['milestones']) {
  return `On track when ${r.onTrackMaxLatePct}% or fewer of the milestones already due are not done, at risk up to ${r.atRiskMaxLatePct}%, off track above that.`;
}

/** Revenue vs target and margin for the fiscal quarter so far, and cash runway. `months` is the company total per month. */
export function evaluateFinance(months: MonthTotals[], rules: HealthRules, startMonth: number): FinanceMeasures {
  const sorted = [...months].sort((a, b) => a.period.localeCompare(b.period));
  const withRevenue = sorted.filter((m) => nz(m.revenue));
  const asOf = withRevenue.length ? withRevenue[withRevenue.length - 1].period : null;
  const lab = { revenue: 'Revenue vs target', margin: 'Margin', runway: 'Cash runway' };
  const rules3 = { revenue: revenueRule(rules.revenue), margin: marginRule(rules.margin), runway: runwayRule(rules.runway) };

  let revenue = noData('revenue', lab.revenue, 'No revenue has been uploaded yet.', rules3.revenue);
  let margin = noData('margin', lab.margin, 'No revenue and cost figures have been uploaded yet.', rules3.margin);
  let window: FinanceMeasures['window'] = null;

  if (asOf) {
    const from = quarterStart(asOf, startMonth);
    const label = fiscalQuarterLabel(asOf, startMonth);
    window = { from, to: asOf, label };
    const inWindow = sorted.filter((m) => m.period >= from && m.period <= asOf);

    const pairs = inWindow.filter((m) => nz(m.revenue) && nz(m.target));
    const target = pairs.reduce((s, m) => s + m.target!, 0);
    if (pairs.length && target > 0) {
      const v = round1((pairs.reduce((s, m) => s + m.revenue!, 0) / target) * 100);
      const status = higher(v, rules.revenue.onTrackMin, rules.revenue.atRiskMin);
      revenue = { key: 'revenue', label: lab.revenue, status, value: v, unit: '%', summary: `Revenue is ${v}% of target in ${label} so far`, rule: rules3.revenue };
    } else {
      revenue = noData('revenue', lab.revenue, `No month in ${label} has both revenue and a target.`, rules3.revenue);
    }

    const mp = inWindow.filter((m) => nz(m.revenue) && nz(m.cost));
    const rev = mp.reduce((s, m) => s + m.revenue!, 0);
    if (mp.length && rev > 0) {
      const v = round1(((rev - mp.reduce((s, m) => s + m.cost!, 0)) / rev) * 100);
      const status = higher(v, rules.margin.onTrackMin, rules.margin.atRiskMin);
      margin = { key: 'margin', label: lab.margin, status, value: v, unit: '%', summary: `Margin is ${v}% in ${label} so far`, rule: rules3.margin };
    } else {
      margin = noData('margin', lab.margin, `No month in ${label} has both revenue and cost.`, rules3.margin);
    }
  }

  // Runway: latest closing cash balance over the average monthly burn of the last three months that have burn data.
  let runway = noData('runway', lab.runway, 'No closing cash balance has been uploaded yet.', rules3.runway);
  const cashMonths = sorted.filter((m) => nz(m.closingCash));
  if (cashMonths.length) {
    const last = cashMonths[cashMonths.length - 1];
    const burns: number[] = [];
    for (const m of [...sorted].reverse()) {
      if (m.period > last.period) continue;
      if (nz(m.cashIn) && nz(m.cashOut)) burns.push(m.cashOut - m.cashIn);
      else if (nz(m.revenue) && nz(m.cost)) burns.push(m.cost - m.revenue);
      if (burns.length === 3) break;
    }
    if (!burns.length) {
      runway = noData('runway', lab.runway, 'Cash in/out (or revenue and cost) are missing, so the burn rate is unknown.', rules3.runway);
    } else {
      const burn = burns.reduce((s, b) => s + b, 0) / burns.length;
      const cash = last.closingCash!;
      if (cash <= 0) {
        runway = { key: 'runway', label: lab.runway, status: 'off_track', value: 0, unit: 'months', summary: `Cash is ${cash < 0 ? 'negative' : 'zero'} as of ${monthLabel(last.period)}`, rule: rules3.runway };
      } else if (burn <= 0) {
        runway = { key: 'runway', label: lab.runway, status: 'on_track', value: null, unit: 'months', summary: `Not burning cash (as of ${monthLabel(last.period)})`, rule: rules3.runway };
      } else {
        const v = round1(cash / burn);
        const status = higher(v, rules.runway.onTrackMinMonths, rules.runway.atRiskMinMonths);
        runway = { key: 'runway', label: lab.runway, status, value: v, unit: 'months', summary: `${v} months of cash at the recent burn (as of ${monthLabel(last.period)})`, rule: rules3.runway };
      }
    }
  }
  return { revenue, margin, runway, asOf, window };
}

/** `due` = milestones already due on a live goal; `late` = how many of those are not done. */
export function evaluateMilestones(counts: { due: number; late: number }, rules: HealthRules): Measure {
  const rule = milestoneRule(rules.milestones);
  if (counts.due === 0) return noData('milestones', 'Milestone delivery', 'No milestone has come due yet.', rule);
  const v = round1((counts.late / counts.due) * 100);
  const status = lower(v, rules.milestones.onTrackMaxLatePct, rules.milestones.atRiskMaxLatePct);
  return {
    key: 'milestones',
    label: 'Milestone delivery',
    status,
    value: v,
    unit: '%',
    summary: `${counts.late} of ${counts.due} milestones already due ${counts.late === 1 ? 'is' : 'are'} not done (${v}%)`,
    rule,
  };
}

export const STATUS_LABEL: Record<Status, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
const RANK: Record<MeasureStatus, number> = { no_data: -1, on_track: 0, at_risk: 1, off_track: 2 };

export interface Overall {
  status: Status | 'unknown';
  reason: string;
}

/** Worst measure wins. Measures without data are listed in the reason but never count for or against. */
export function overall(measures: Measure[]): Overall {
  const withData = measures.filter((m) => m.status !== 'no_data');
  const missing = measures.filter((m) => m.status === 'no_data').map((m) => m.label.toLowerCase());
  if (!withData.length) return { status: 'unknown', reason: 'No figures yet. Upload a sheet and add milestones to see how the company is doing.' };
  const worst = Math.max(...withData.map((m) => RANK[m.status]));
  const status = (['on_track', 'at_risk', 'off_track'] as const)[worst];
  const note = missing.length ? ` No data yet for ${missing.join(', ')}.` : '';
  if (status === 'on_track') return { status, reason: `Every measure with data is on track.${note}` };
  const culprits = withData.filter((m) => RANK[m.status] === worst).map((m) => m.summary);
  return { status, reason: `${culprits.join('; ')}.${note}` };
}
