'use client';
import { ReactNode, useId, useState } from 'react';
import { EChart } from './EChart';
import { gaugeOption, sparkOption } from './options';
import { HEALTH, INK } from './theme';
import type { MeasureStatus } from '@/lib/types';

export interface TableData {
  head: string[];
  rows: (string | number)[][];
}

/** A chart card: title, optional note, a Chart/Table switch, and the chart. The table holds the exact numbers. */
export function ChartCard({ title, note, table, children, wide }: { title: string; note?: string; table: TableData; children: ReactNode; wide?: boolean }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const id = useId();
  return (
    <section className={`card vcard ${wide ? 'wide' : ''}`} aria-labelledby={id}>
      <div className="row spread" style={{ alignItems: 'start' }}>
        <div>
          <h2 id={id} style={{ marginBottom: 2 }}>{title}</h2>
          {note && <div className="muted" style={{ fontSize: 13 }}>{note}</div>}
        </div>
        <div className="seg" role="group" aria-label={`${title} view`}>
          <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        {view === 'chart' ? children : (
          <div className="scroll">
            <table>
              <thead><tr>{table.head.map((h, i) => <th key={i} style={i ? { textAlign: 'right' } : undefined}>{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={j ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : undefined}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** A legend: a swatch, the name, and the figure beside it. Text stays in text colours; only the swatch carries identity. */
export function Legend({ items }: { items: { name: string; color: string; value?: string; share?: string }[] }) {
  return (
    <ul className="vlegend">
      {items.map((it) => (
        <li key={it.name}>
          <i style={{ background: it.color }} aria-hidden />
          <span className="name">{it.name}</span>
          {it.value && <b>{it.value}</b>}
          {it.share && <span className="muted">{it.share}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Inline legend for line and bar charts (names only). */
export function KeyRow({ items, line }: { items: { name: string; color: string }[]; line?: boolean }) {
  return (
    <ul className="vlegend inline" aria-label="Legend">
      {items.map((it) => (
        <li key={it.name}><i className={line ? 'line' : ''} style={{ background: it.color }} aria-hidden /><span className="name">{it.name}</span></li>
      ))}
    </ul>
  );
}

/** A figure: label, big number, an optional change line and sparkline. Not a chart, so no table twin. */
export function StatTile({ label, value, sub, subTone, spark, sparkColor, hero }: { label: string; value: string; sub?: string; subTone?: 'good' | 'bad' | 'muted'; spark?: (number | null)[]; sparkColor?: string; hero?: boolean }) {
  return (
    <div className="stat">
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
      <div className={hero ? 'hero' : 'val'}>{value}</div>
      {sub && <div className={`sub ${subTone ?? 'muted'}`}>{sub}</div>}
      {spark && spark.filter((v) => v !== null).length > 1 && (
        <div style={{ marginTop: 6 }}><EChart option={sparkOption(spark, sparkColor ?? INK.primary)} height={36} label={`${label} trend, last ${spark.length} months`} /></div>
      )}
    </div>
  );
}

/** Health status as an icon, a word and a colour, never colour alone. */
export function StatusBadge({ status }: { status: MeasureStatus | 'unknown' }) {
  const h = HEALTH[status];
  return <span className="sbadge" style={{ color: h.text, borderColor: h.color }}><span aria-hidden>{h.icon}</span> {h.label}</span>;
}

/** A meter tile for one health measure. */
export function MeterTile({ label, status, value, text, min, max, caption, rule }: { label: string; status: MeasureStatus; value: number | null; text: string; min: number; max: number; caption: string; rule: string }) {
  const h = HEALTH[status];
  return (
    <div className="meter">
      <div className="row spread" style={{ gap: 6 }}>
        <b style={{ fontWeight: 500 }}>{label}</b>
        <StatusBadge status={status} />
      </div>
      {status === 'no_data' || value === null ? (
        <div className="nodata" style={{ height: 120 }}><span className="muted">{status === 'no_data' ? 'No data' : text}</span></div>
      ) : (
        <EChart option={gaugeOption(value, min, max, h.color, text)} height={130} label={`${label}: ${text}, ${h.label}`} />
      )}
      <div className="row spread muted" style={{ fontSize: 12, marginTop: -6 }}><span>{min}</span><span>{max}{label === 'Cash runway' ? '+' : ''}</span></div>
      <div style={{ fontSize: 13, marginTop: 6 }}>{caption}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{rule}</div>
    </div>
  );
}
