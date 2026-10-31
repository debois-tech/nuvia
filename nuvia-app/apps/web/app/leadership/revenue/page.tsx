'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { ChartCard, KeyRow, Legend, StatTile } from '@/components/charts/Cards';
import { EChart } from '@/components/charts/EChart';
import { barOption, colorFor, donutOption, lineOption, Slice } from '@/components/charts/options';
import { BLUE, OTHER, REFERENCE, SERIES, STATUS, money, pctText } from '@/components/charts/theme';
import { ExecOnly } from '@/components/leadership/Parts';
import { RangeBar, rangeQuery, useRangeState } from '@/components/leadership/RangeBar';
import { PageHeader } from '@/components/ui';
import { Shell } from '@/components/Shell';
import { useApi } from '@/lib/api';
import { FinanceDashboard } from '@/lib/types';

const addMonths = (ym: string, n: number) => {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

function Dashboard() {
  const [range, setRange] = useRangeState();
  const qs = rangeQuery(range);
  const { data: d, error, loading } = useApi<FinanceDashboard>(`leadership/finance${qs ? `?${qs}` : ''}`);
  const cur = d?.currency ?? 'INR';
  const full = (n: number) => money(n, cur);
  const short = (n: number) => money(n, cur, true);

  const view = useMemo(() => {
    if (!d || !d.totals) return null;
    const labels = d.months.map((m) => m.label.replace(/ 20(\d\d)$/, " '$1"));
    const deps = d.departments.filter((x) => (x.revenue ?? 0) > 0);
    const top = deps.slice(0, 6);
    const rest = deps.slice(6).reduce((s, x) => s + (x.revenue ?? 0), 0);
    // A department keeps its colour by its place in the alphabet, so it doesn't change when the ranking does.
    const order = [...top].sort((a, b) => a.department.localeCompare(b.department)).map((x) => x.department);
    const slices: Slice[] = top.map((x) => ({ name: x.department, value: x.revenue ?? 0, color: colorFor(order.indexOf(x.department)) }));
    if (rest > 0) slices.push({ name: `Other (${deps.length - 6})`, value: rest, color: OTHER });
    return { labels, slices, total: slices.reduce((s, x) => s + x.value, 0) };
  }, [d]);

  return (
    <>
      <PageHeader title="Revenue">
        <RangeBar state={range} onChange={setRange} range={d?.range ?? null} compareRange={d?.compare?.range ?? null} asOf={d?.asOf ?? null} available={d?.available ?? null}>
          <Link href="/leadership/import" className="greybtn" style={{ textDecoration: 'none' }}>Import sheet</Link>
          <Link href="/leadership/health" className="greybtn" style={{ textDecoration: 'none' }}>Health rules</Link>
        </RangeBar>
      </PageHeader>
      {error && <p className="err" role="alert">{error}</p>}
      {d && !d.totals && (
        <section className="card"><p>No figures yet. <Link href="/leadership/import">Upload a sheet</Link> to see revenue, trends and the department split.</p></section>
      )}
      {d && d.totals && view && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
          <div className="stats">
            <StatTile hero label="Revenue" value={short(d.totals.revenue ?? 0)} sub={d.compare && d.compare.totals.revenue ? `${Math.round(((d.totals.revenue ?? 0) - d.compare.totals.revenue) / d.compare.totals.revenue * 1000) / 10}% vs ${short(d.compare.totals.revenue)} before` : `${d.range!.from} to ${d.range!.to}`} spark={d.months.map((m) => m.revenue)} sparkColor={BLUE} />
            <StatTile label="Against target" value={pctText(d.totals.attainmentPct)} sub={d.totals.target !== null ? `Target ${short(d.totals.target)}` : 'No target in this range'} subTone={d.totals.attainmentPct === null ? 'muted' : d.totals.attainmentPct >= 95 ? 'good' : d.totals.attainmentPct < 80 ? 'bad' : 'muted'} />
            <StatTile label="Margin" value={pctText(d.totals.marginPct)} sub={d.totals.cost !== null ? `Cost ${short(d.totals.cost)}` : 'No cost in this range'} />
            <StatTile label="Net cash" value={d.totals.cashIn !== null && d.totals.cashOut !== null ? short(d.totals.cashIn - d.totals.cashOut) : '–'} sub={d.totals.cashIn !== null ? `In ${short(d.totals.cashIn)} · out ${short(d.totals.cashOut ?? 0)}` : 'No cash figures'} subTone={d.totals.cashIn !== null && d.totals.cashOut !== null && d.totals.cashIn < d.totals.cashOut ? 'bad' : 'muted'} />
          </div>

          <div className="vgrid">
            <ChartCard wide title="Revenue against target" note="By month. Months without a target show the revenue only."
              table={{ head: ['Month', 'Revenue', 'Target', '% of target'], rows: d.months.map((m) => [m.label, m.revenue === null ? '–' : full(m.revenue), m.target === null ? '–' : full(m.target), pctText(m.attainmentPct)]) }}>
              <KeyRow line items={[{ name: 'Revenue', color: BLUE }, { name: 'Target', color: REFERENCE }]} />
              <EChart height={280} loading={loading} label={`Revenue against target by month, ${d.range!.from} to ${d.range!.to}`}
                option={lineOption(view.labels, [{ name: 'Revenue', data: d.months.map((m) => m.revenue), color: BLUE }, { name: 'Target', data: d.months.map((m) => m.target), color: REFERENCE }], full, short, true)} />
            </ChartCard>

            <ChartCard title="Quarter by quarter" note={d.quarters.some((q) => !q.complete) ? 'A quarter with fewer than three months is still in progress.' : undefined}
              table={{ head: ['Quarter', 'Months', 'Revenue', 'Target', '% of target'], rows: d.quarters.map((q) => [q.label, q.months, q.revenue === null ? '–' : full(q.revenue), q.target === null ? '–' : full(q.target), pctText(q.attainmentPct)]) }}>
              <KeyRow items={[{ name: 'Revenue', color: BLUE }, { name: 'Target', color: REFERENCE }]} />
              <EChart height={260} loading={loading} label="Revenue and target by fiscal quarter"
                option={barOption(d.quarters.map((q) => (q.complete ? q.label : `${q.label}\n(so far)`)), [{ name: 'Revenue', data: d.quarters.map((q) => q.revenue), color: BLUE }, { name: 'Target', data: d.quarters.map((q) => q.target), color: REFERENCE }], full, short)} />
            </ChartCard>

            <ChartCard title="Department split" note="Share of revenue in the range"
              table={{ head: ['Department', 'Revenue', 'Target', '% of target'], rows: d.departments.map((x) => [x.department, x.revenue === null ? '–' : full(x.revenue), x.target === null ? '–' : full(x.target), pctText(x.attainmentPct)]) }}>
              {view.slices.length === 0 ? <p className="muted">No department revenue in this range.</p> : (
                <div className="row" style={{ alignItems: 'center', gap: 16 }}>
                  <div style={{ flex: '1 1 180px', minWidth: 160 }}>
                    <EChart height={210} loading={loading} label={`Revenue by department: ${view.slices.map((s) => s.name).join(', ')}`} option={donutOption(view.slices, full, { value: short(view.total), caption: 'Revenue' })} />
                  </div>
                  <div style={{ flex: '1 1 160px' }}>
                    <Legend items={view.slices.map((s) => ({ name: s.name, color: s.color, value: short(s.value), share: `${Math.round((s.value / view.total) * 100)}%` }))} />
                  </div>
                </div>
              )}
              {d.departments.some((x) => x.attainmentPct !== null) && (
                <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                  <div className="muted" style={{ fontSize: 13 }}>Against target</div>
                  {d.departments.filter((x) => x.attainmentPct !== null).map((x) => (
                    <div key={x.department} style={{ fontSize: 13 }}>
                      <div className="row spread" style={{ gap: 6 }}><span>{x.department}</span><b style={{ fontWeight: 600 }}>{x.attainmentPct}%</b></div>
                      <div className="progress" role="img" aria-label={`${x.department}: ${x.attainmentPct}% of target`}><span style={{ width: `${Math.min(100, x.attainmentPct!)}%`, background: x.attainmentPct! >= 95 ? STATUS.good : x.attainmentPct! >= 80 ? STATUS.warning : STATUS.critical }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Cash in and out" note="Months with both figures"
              table={{ head: ['Month', 'Cash in', 'Cash out', 'Net'], rows: d.months.filter((m) => m.cashIn !== null || m.cashOut !== null).map((m) => [m.label, m.cashIn === null ? '–' : full(m.cashIn), m.cashOut === null ? '–' : full(m.cashOut), m.cashIn !== null && m.cashOut !== null ? full(m.cashIn - m.cashOut) : '–']) }}>
              {d.months.some((m) => m.cashIn !== null || m.cashOut !== null) ? (
                <>
                  <KeyRow items={[{ name: 'Cash in', color: SERIES[0] }, { name: 'Cash out', color: SERIES[1] }]} />
                  <EChart height={240} loading={loading} label="Cash in and cash out by month"
                    option={barOption(view.labels, [{ name: 'Cash in', data: d.months.map((m) => m.cashIn), color: SERIES[0] }, { name: 'Cash out', data: d.months.map((m) => m.cashOut), color: SERIES[1] }], full, short)} />
                </>
              ) : <p className="muted">The sheet has no cash in or cash out columns.</p>}
            </ChartCard>

            <ChartCard title="Closing cash" note="Cash balance at the end of each month it was given"
              table={{ head: ['Month', 'Closing cash'], rows: d.months.filter((m) => m.closingCash !== null).map((m) => [m.label, full(m.closingCash!)]) }}>
              {d.months.some((m) => m.closingCash !== null) ? (
                <EChart height={240} loading={loading} label="Closing cash balance by month"
                  option={lineOption(view.labels, [{ name: 'Closing cash', data: d.months.map((m) => m.closingCash), color: BLUE }], full, short, true)} />
              ) : <p className="muted">The sheet has no closing cash column, so runway can't be worked out.</p>}
            </ChartCard>
          </div>
        </div>
      )}
    </>
  );
}

export default function RevenuePage() {
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
