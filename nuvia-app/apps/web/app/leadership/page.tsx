'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { MeterTile, StatusBadge } from '@/components/charts/Cards';
import { colorFor } from '@/components/charts/options';
import { DotMatrix, FunnelColumns, HatchRows, InsightCard, JumpBar, JumpItem, shade, StepLineBars } from '@/components/charts/ref';
import { HEALTH, money, SERIES } from '@/components/charts/theme';
import { ExecOnly } from '@/components/leadership/Parts';
import { RangeBar, rangeQuery, ymLabel, useHiddenWidgets, useRangeState } from '@/components/leadership/RangeBar';
import { Shell } from '@/components/Shell';
import { Card, DataCard, Delta, PageHeader } from '@/components/ui';
import { fmtDate, fmtDateTime, useApi } from '@/lib/api';
import { FinanceDashboard, GoalList, Measure, Overview } from '@/lib/types';

const SCALE: Record<Measure['key'], { min: number; max: number }> = { revenue: { min: 0, max: 120 }, margin: { min: -20, max: 50 }, runway: { min: 0, max: 24 }, milestones: { min: 0, max: 50 } };
const WIDGETS = [
  { id: 'funnel', label: 'Tasks funnel' }, { id: 'revenue', label: 'Revenue' }, { id: 'attainment', label: 'Against target by month' },
  { id: 'done', label: 'Tasks done by weekday' }, { id: 'checkins', label: 'Check-ins by weekday' }, { id: 'health', label: 'Company health' },
  { id: 'alerts', label: 'Needs attention' }, { id: 'goals', label: 'Goals' }, { id: 'measures', label: 'The four measures' },
];
const PAGES: JumpItem[] = [
  { label: 'Overview', kind: 'page', href: '/leadership' }, { label: 'Revenue', kind: 'page', href: '/leadership/revenue' }, { label: 'Goals and timeline', kind: 'page', href: '/leadership/goals' },
  { label: 'Health rules', kind: 'page', href: '/leadership/health' }, { label: 'Import sheet', kind: 'page', href: '/leadership/import' }, { label: 'Tasks', kind: 'page', href: '/tasks' },
  { label: 'Projects', kind: 'page', href: '/projects' }, { label: 'Attendance', kind: 'page', href: '/attendance' },
];

function meterText(m: Measure): string {
  if (m.status === 'no_data') return 'No data';
  if (m.value === null) return m.key === 'runway' ? 'Not burning cash' : '–';
  return m.key === 'runway' ? `${m.value} mo` : `${m.value}%`;
}
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-IN')}`;

function Dashboard() {
  const [range, setRange] = useRangeState();
  const qs = rangeQuery(range);
  const q = qs ? `?${qs}` : '';
  const ov = useApi<Overview>(`leadership/overview${q}`, 60_000);
  const fin = useApi<FinanceDashboard>(`leadership/finance${q}`);
  const goals = useApi<GoalList>('leadership/goals');
  const [hidden, toggle] = useHiddenWidgets('nuvia.leadership.widgets');
  const show = (id: string) => !hidden.includes(id);

  const o = ov.data;
  const f = fin.data;
  const cur = f?.currency ?? 'INR';
  const jump = useMemo<JumpItem[]>(() => [
    ...PAGES,
    ...(goals.data?.goals.flatMap((g) => [{ label: g.title, kind: 'goal', href: `/leadership/goals/${g.id}` }, ...g.milestones.map((m) => ({ label: `${m.title} (${g.title})`, kind: 'milestone', href: `/leadership/goals/${g.id}` }))]) ?? []),
  ], [goals.data]);

  const top = useMemo(() => {
    const deps = (f?.departments ?? []).filter((d) => (d.revenue ?? 0) > 0);
    const shown = deps.slice(0, 3);
    const rest = deps.slice(3).reduce((s, d) => s + (d.revenue ?? 0), 0);
    const order = [...(f?.departments ?? [])].filter((d) => (d.revenue ?? 0) > 0).slice(0, 6).map((d) => d.department).sort();
    const rows: { name: string; amount: number; color: string }[] = shown.map((d) => ({ name: d.department, amount: d.revenue ?? 0, color: colorFor(order.indexOf(d.department)) as string }));
    if (rest > 0) rows.push({ name: `Other (${deps.length - 3})`, amount: rest, color: '#9a9aa2' });
    const max = Math.max(...rows.map((r) => r.amount), 1);
    return { rows, max };
  }, [f]);

  const t = f?.totals;
  const cmp = f?.compare?.totals;
  const revDelta = t?.revenue != null && cmp?.revenue ? Math.round(((t.revenue - cmp.revenue) / cmp.revenue) * 1000) / 10 : null;
  const act = o?.activity;
  const steps = act ? [
    { label: 'Created', value: act.tasks.created }, { label: 'Assigned', value: act.tasks.assigned }, { label: 'In progress', value: act.tasks.started },
    { label: 'In review', value: act.tasks.inReview }, { label: 'Done', value: act.tasks.done },
  ] : [];
  const monthShort = (p: string) => ymLabel(p).slice(0, 3);
  const health = o?.health;
  const h = health ? HEALTH[health.status] : null;

  return (
    <>
      <PageHeader title="Overview">
        <RangeBar state={range} onChange={setRange} range={act?.range ?? f?.range ?? null} compareRange={act?.compareRange ?? null} asOf={f?.asOf ?? null} available={f?.available ?? null} widgets={WIDGETS} hidden={hidden} onToggleWidget={toggle} />
      </PageHeader>
      {(ov.error || fin.error) && <p className="err" role="alert">{ov.error ?? fin.error}</p>}
      {!o && !ov.error && <p className="muted">Loading…</p>}
      {o && health && h && (
        <div style={{ opacity: ov.loading || fin.loading ? 0.65 : 1, transition: 'opacity .15s' }}>
          {!health.rulesConfirmed && (
            <div className="banner" role="note">
              The thresholds behind the company-health verdict are <b>proposed defaults</b>. The CEO, CTO and COO have not confirmed them yet. <Link href="/leadership/health">Review the rules</Link>
            </div>
          )}
          <div className="dash">
            {show('funnel') && (
              <DataCard className="span2" title="Tasks" sub={act ? `Created ${act.range.from === act.range.to ? 'in' : 'between'} ${ymLabel(act.range.from)}${act.range.from === act.range.to ? '' : ` and ${ymLabel(act.range.to)}`}` : undefined}
                links={[{ label: 'Open tasks', href: '/tasks' }]}
                table={{ head: ['Stage', 'Tasks', '% of the stage before'], rows: steps.map((s, i) => [s.label, s.value, i === 0 || !steps[i - 1].value ? '–' : `${Math.round((s.value / steps[i - 1].value) * 100)}%`]) }}>
                <FunnelColumns steps={steps} unit="tasks" ariaLabel="Task funnel: created, assigned, in progress, in review, done" />
                <JumpBar items={jump} />
              </DataCard>
            )}

            {show('revenue') && (
              <DataCard title="Revenue" sub={f?.range ? `${ymLabel(f.range.from)}${f.range.from === f.range.to ? '' : ` – ${ymLabel(f.range.to)}`}` : undefined} links={[{ label: 'Open revenue', href: '/leadership/revenue' }, { label: 'Import a sheet', href: '/leadership/import' }]}
                table={{ head: ['Department', 'Revenue', 'Target', '% of target'], rows: (f?.departments ?? []).map((d) => [d.department, d.revenue == null ? '–' : money(d.revenue, cur), d.target == null ? '–' : money(d.target, cur), d.attainmentPct == null ? '–' : `${d.attainmentPct}%`]) }}>
                {!t || t.revenue == null ? (
                  <p className="muted">No revenue in this range. <Link href="/leadership/import">Upload a sheet</Link>.</p>
                ) : (
                  <>
                    <div className="row" style={{ gap: 14, margin: '18px 0 6px' }}>
                      <div className="bignum md">{money(t.revenue, cur, true)}</div>
                      {revDelta !== null && <Delta value={revDelta} />}
                    </div>
                    <div className="muted" style={{ fontSize: 13, marginBottom: 14, minHeight: 20 }}>
                      {t.attainmentPct != null && <>{t.attainmentPct}% of target{t.target != null ? ` (${money(t.target, cur, true)})` : ''}</>}
                      {f?.compare && revDelta !== null && <> · vs {money(f.compare.totals.revenue ?? 0, cur, true)} before</>}
                    </div>
                    <hr style={{ border: 0, borderTop: '1px solid #e7e7ea', margin: '0 0 14px' }} />
                    <HatchRows rows={top.rows.map((r) => ({ name: r.name, value: money(r.amount, cur, true), share: r.amount / top.max, c1: r.color, c2: shade(r.color, -0.22) }))} />
                  </>
                )}
              </DataCard>
            )}

            {show('attainment') && (
              <DataCard title="Against target" sub="Revenue as a share of target, by month" links={[{ label: 'Open revenue', href: '/leadership/revenue' }]}
                table={{ head: ['Month', '% of target', 'Revenue', 'Target'], rows: (f?.months ?? []).map((m) => [m.label, m.attainmentPct == null ? '–' : `${m.attainmentPct}%`, m.revenue == null ? '–' : money(m.revenue, cur), m.target == null ? '–' : money(m.target, cur)]) }}>
                <StepLineBars values={(f?.months ?? []).map((m) => m.attainmentPct)} labels={(f?.months ?? []).map((m) => monthShort(m.period + '-01'))} format={(n) => `${n}%`} ariaLabel="Revenue as a percentage of target, by month" />
              </DataCard>
            )}

            {(show('done') || show('checkins')) && (
              <div className="stackcol">
                {show('done') && act && (
                  <DataCard title="Tasks done" links={[{ label: 'Open tasks', href: '/tasks' }]}
                    table={{ head: ['Day', 'Tasks done'], rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => [d, act.completed.byWeekday[i]]) }}>
                    <div className="dotcard">
                      <div className="bignum sm">{act.completed.total.toLocaleString('en-IN')}</div>
                      <DotMatrix counts={act.completed.byWeekday} color="#17a34a" pale="#a8dcb8" ariaLabel="Tasks done by weekday" />
                      <div className="vs"><div className="l">vs last period</div><div className="v">{act.compare ? signed(act.completed.total - act.compare.completed.total) : '–'}</div></div>
                    </div>
                  </DataCard>
                )}
                {show('checkins') && act && (
                  <DataCard title="Check-ins" links={[{ label: 'Open attendance', href: '/attendance' }]}
                    table={{ head: ['Day', 'Check-ins'], rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => [d, act.checkIns.byWeekday[i]]) }}>
                    <div className="dotcard">
                      <div className="bignum sm">{act.checkIns.total.toLocaleString('en-IN')}</div>
                      <DotMatrix counts={act.checkIns.byWeekday} color="#2563eb" pale="#b4cdf6" peakWord="Highest" ariaLabel="Check-ins by weekday" />
                      <div className="vs"><div className="l">vs last period</div><div className="v">{act.compare ? signed(act.checkIns.total - act.compare.checkIns.total) : '–'}</div></div>
                    </div>
                  </DataCard>
                )}
              </div>
            )}

            {show('health') && (
              <InsightCard tag="Company health" big={h.label} word headline={health.reason} body={health.asOf ? `Figures up to ${fmtDate(health.asOf)}.${o.latestImport ? ` Last upload ${fmtDateTime(o.latestImport.uploadedAt)}.` : ''}` : undefined} segments={health.measures.map((m) => m.status === 'on_track')} />
            )}

            {show('alerts') && (
              <Card className="span2" title="Needs attention" sub={o.alerts.length ? `${o.alerts.length} open` : undefined}>
                {o.alerts.length === 0 && <p className="ok" style={{ margin: 0 }}>✓ Nothing is off track right now.</p>}
                {o.alerts.map((a) => (
                  <div key={a.key} className={`alert ${a.severity}`}>
                    <span className="ic" aria-hidden>{a.severity === 'critical' ? '✕' : '▲'}</span>
                    <div style={{ flex: 1 }}>
                      <div><b style={{ fontWeight: 600 }}>{a.title}</b> <span className="muted" style={{ fontSize: 12 }}>{a.severity === 'critical' ? 'Off track' : 'At risk'} since {fmtDate(a.raisedAt.slice(0, 10))}</span></div>
                      <div className="muted" style={{ fontSize: 14 }}>{a.detail}</div>
                    </div>
                    <Link href={a.link}>Open</Link>
                  </div>
                ))}
              </Card>
            )}

            {show('goals') && (
              <Card title="Goals" menu={[{ label: 'Timeline and goals', href: '/leadership/goals' }]}>
                <div className="bignum sm" style={{ margin: '6px 0 12px' }}>{o.goals.active} <span className="muted" style={{ fontSize: 18, letterSpacing: 0 }}>active</span></div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="row spread"><StatusBadge status="on_track" /><b style={{ fontWeight: 500 }}>{o.goals.onTrack}</b></div>
                  <div className="row spread"><StatusBadge status="at_risk" /><b style={{ fontWeight: 500 }}>{o.goals.atRisk}</b></div>
                  <div className="row spread"><StatusBadge status="off_track" /><b style={{ fontWeight: 500 }}>{o.goals.offTrack}</b></div>
                  <div className="row spread muted"><span>Done</span><span>{o.goals.done}</span></div>
                </div>
              </Card>
            )}

            {show('measures') && (
              <Card className="span3" title="The four measures" sub={health.window ? `Revenue and margin cover ${health.window.label} so far` : undefined} menu={[{ label: 'Health rules', href: '/leadership/health' }]}>
                <div className="meters">
                  {health.measures.map((m) => (
                    <MeterTile key={m.key} label={m.label} status={m.status} value={m.value} text={meterText(m)} min={SCALE[m.key].min} max={SCALE[m.key].max} caption={m.summary} rule={m.rule} />
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function LeadershipHome() {
  return (
    <Shell>
      {(me) => (
        <ExecOnly me={me}>
          <Dashboard />
        </ExecOnly>
      )}
    </Shell>
  );
}
