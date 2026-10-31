import { DEFAULT_RULES, evaluateFinance, evaluateMilestones, fiscalQuarterLabel, HealthRulesSchema, Measure, MonthTotals, overall, quarterStart } from '../src/leadership/health';
import { milestoneState } from '../src/leadership/goal-queries';

const m = (period: string, o: Partial<MonthTotals> = {}): MonthTotals => ({ period: `${period}-01`, revenue: null, target: null, cost: null, cashIn: null, cashOut: null, closingCash: null, ...o });
const R = DEFAULT_RULES;

describe('fiscal calendar (year starts in April)', () => {
  it('names quarters and finds where they start', () => {
    expect(fiscalQuarterLabel('2026-04-01', 4)).toBe('Q1 FY2026-27');
    expect(fiscalQuarterLabel('2026-06-01', 4)).toBe('Q1 FY2026-27');
    expect(fiscalQuarterLabel('2026-07-01', 4)).toBe('Q2 FY2026-27');
    expect(fiscalQuarterLabel('2027-01-01', 4)).toBe('Q4 FY2026-27');
    expect(fiscalQuarterLabel('2027-03-01', 4)).toBe('Q4 FY2026-27');
    expect(fiscalQuarterLabel('2026-02-01', 1)).toBe('Q1 2026');
    expect(quarterStart('2026-06-01', 4)).toBe('2026-04-01');
    expect(quarterStart('2027-02-01', 4)).toBe('2027-01-01');
    expect(quarterStart('2026-11-01', 11)).toBe('2026-11-01');
    expect(quarterStart('2027-01-01', 11)).toBe('2026-11-01');
  });
});

describe('revenue and margin (fiscal quarter so far)', () => {
  it('judges revenue as a share of target over the quarter to date', () => {
    const months = [m('2026-04', { revenue: 90, target: 100 }), m('2026-05', { revenue: 80, target: 100 })];
    const f = evaluateFinance(months, R, 4);
    expect(f.asOf).toBe('2026-05-01');
    expect(f.revenue.value).toBe(85);
    expect(f.revenue.status).toBe('at_risk');
    expect(f.revenue.summary).toBe('Revenue is 85% of target in Q1 FY2026-27 so far');
  });

  it('only looks at the current quarter, so last quarter does not drag it down', () => {
    const months = [m('2026-03', { revenue: 10, target: 100 }), m('2026-04', { revenue: 100, target: 100 })];
    expect(evaluateFinance(months, R, 4).revenue.status).toBe('on_track');
  });

  it('uses the rounded number it shows, so 94.96% is judged as 95.0%', () => {
    expect(evaluateFinance([m('2026-04', { revenue: 94.96, target: 100 })], R, 4).revenue.status).toBe('on_track');
    expect(evaluateFinance([m('2026-04', { revenue: 94.94, target: 100 })], R, 4).revenue.status).toBe('at_risk');
  });

  it('is off track below the at-risk line and counts only months that have both revenue and target', () => {
    const f = evaluateFinance([m('2026-04', { revenue: 50, target: 100 }), m('2026-05', { revenue: 500 })], R, 4);
    expect(f.revenue.value).toBe(50);
    expect(f.revenue.status).toBe('off_track');
  });

  it('has no data without targets, or without revenue', () => {
    expect(evaluateFinance([m('2026-04', { revenue: 5 })], R, 4).revenue.status).toBe('no_data');
    expect(evaluateFinance([], R, 4).revenue.status).toBe('no_data');
    expect(evaluateFinance([m('2026-04', { target: 5 })], R, 4).asOf).toBeNull();
  });

  it('computes margin from revenue and cost', () => {
    const f = evaluateFinance([m('2026-04', { revenue: 100, cost: 85 })], R, 4);
    expect(f.margin.value).toBe(15);
    expect(f.margin.status).toBe('at_risk');
    expect(evaluateFinance([m('2026-04', { revenue: 100, cost: 120 })], R, 4).margin.status).toBe('off_track');
    expect(evaluateFinance([m('2026-04', { revenue: 100, cost: 50 })], R, 4).margin.status).toBe('on_track');
    expect(evaluateFinance([m('2026-04', { revenue: 100 })], R, 4).margin.status).toBe('no_data');
  });
});

describe('runway', () => {
  it('is cash over the average burn of the last three months', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04'].map((p, i) => m(p, { cashIn: 100, cashOut: 200 + i * 10, closingCash: i === 3 ? 600 : null }));
    // burns for Apr, Mar, Feb = 130, 120, 110 -> 120
    const r = evaluateFinance(months, R, 4).runway;
    expect(r.value).toBe(5);
    expect(r.status).toBe('off_track');
  });

  it('falls back to cost minus revenue when cash in/out are missing', () => {
    const r = evaluateFinance([m('2026-04', { revenue: 100, cost: 150, closingCash: 400 })], R, 4).runway;
    expect(r.value).toBe(8);
    expect(r.status).toBe('at_risk');
  });

  it('is on track when cash is not being burned, off track when cash is gone, and no_data without burn figures', () => {
    expect(evaluateFinance([m('2026-04', { cashIn: 200, cashOut: 100, closingCash: 50 })], R, 4).runway).toMatchObject({ status: 'on_track', value: null });
    expect(evaluateFinance([m('2026-04', { cashIn: 0, cashOut: 100, closingCash: 0 })], R, 4).runway).toMatchObject({ status: 'off_track', value: 0 });
    expect(evaluateFinance([m('2026-04', { closingCash: 500 })], R, 4).runway.status).toBe('no_data');
  });

  it('uses the latest month that has a cash balance', () => {
    const months = [m('2026-04', { cashIn: 0, cashOut: 100, closingCash: 1200 }), m('2026-05', { revenue: 1, cost: 1 })];
    expect(evaluateFinance(months, R, 4).runway.value).toBe(12);
  });
});

describe('milestones and the overall verdict', () => {
  it('rates the share of due milestones that are not done (lower is better)', () => {
    expect(evaluateMilestones({ due: 10, late: 1 }, R).status).toBe('on_track');
    expect(evaluateMilestones({ due: 10, late: 2 }, R).status).toBe('at_risk');
    expect(evaluateMilestones({ due: 10, late: 3 }, R).status).toBe('off_track');
    expect(evaluateMilestones({ due: 0, late: 0 }, R).status).toBe('no_data');
  });

  const mk = (status: Measure['status'], label: string, summary = label): Measure => ({ key: 'revenue', label, status, value: 1, unit: '%', summary, rule: '' });

  it('takes the worst measure, names it, and ignores measures without data', () => {
    const o = overall([mk('on_track', 'Revenue'), mk('off_track', 'Runway', 'Runway is 4 months'), mk('at_risk', 'Margin'), mk('no_data', 'Milestone delivery')]);
    expect(o.status).toBe('off_track');
    expect(o.reason).toBe('Runway is 4 months. No data yet for milestone delivery.');
    expect(overall([mk('on_track', 'A'), mk('no_data', 'B')]).reason).toMatch(/Every measure with data is on track\. No data yet for b/);
    expect(overall([mk('no_data', 'A')]).status).toBe('unknown');
  });
});

describe('milestone state', () => {
  const rules = R.milestones; // warn within 14 days when under 50% done
  const base = { doneAt: null, tasksTotal: 4, tasksDone: 1 };
  it('is overdue after its date, at risk when close and behind, and never at risk without linked work', () => {
    expect(milestoneState({ ...base, dueDate: '2026-03-01' }, '2026-03-02', rules)).toEqual({ state: 'overdue', daysLeft: -1 });
    expect(milestoneState({ ...base, dueDate: '2026-03-02' }, '2026-03-02', rules).state).toBe('at_risk'); // due today
    expect(milestoneState({ ...base, dueDate: '2026-03-16' }, '2026-03-02', rules).state).toBe('at_risk');
    expect(milestoneState({ ...base, dueDate: '2026-03-17' }, '2026-03-02', rules).state).toBe('on_track');
    expect(milestoneState({ ...base, tasksDone: 2, dueDate: '2026-03-05' }, '2026-03-02', rules).state).toBe('on_track');
    expect(milestoneState({ ...base, tasksTotal: 0, tasksDone: 0, dueDate: '2026-03-05' }, '2026-03-02', rules).state).toBe('on_track');
    expect(milestoneState({ ...base, doneAt: 'x', dueDate: '2026-01-01' }, '2026-03-02', rules).state).toBe('done');
  });
});

describe('rules validation', () => {
  it('accepts the defaults and rejects inverted thresholds and unknown keys', () => {
    expect(HealthRulesSchema.safeParse(DEFAULT_RULES).success).toBe(true);
    expect(HealthRulesSchema.safeParse({ ...DEFAULT_RULES, revenue: { onTrackMin: 80, atRiskMin: 90 } }).success).toBe(false);
    expect(HealthRulesSchema.safeParse({ ...DEFAULT_RULES, milestones: { ...DEFAULT_RULES.milestones, onTrackMaxLatePct: 50 } }).success).toBe(false);
    expect(HealthRulesSchema.safeParse({ ...DEFAULT_RULES, extra: 1 }).success).toBe(false);
    expect(HealthRulesSchema.safeParse({ ...DEFAULT_RULES, runway: { onTrackMinMonths: 12, atRiskMinMonths: -1 } }).success).toBe(false);
  });
});
