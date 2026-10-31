'use client';
import { useRouter } from 'next/navigation';
import { ReactNode, useId, useMemo, useState } from 'react';
import { BulbIcon, ChevronUpIcon, SearchIcon, SparkleIcon } from '../Icons';

// The chart styles of the Dribbble reference, drawn with plain HTML and SVG: a stepped funnel of hatched columns,
// hatched progress bars, a step line over fading bars, dot-matrix histograms, a gradient insight card and a frosted
// search bar. Every one is backed by a table view elsewhere on the page and says its numbers in text.

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const compactNum = (n: number) => (Math.abs(n) >= 10_000 ? compact.format(n) : String(Math.round(n * 10) / 10));

/** A round top for the y-axis with four equal, clean steps. */
export function niceTop(v: number): number {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v / 4));
  for (const m of [1, 2, 2.5, 5, 10]) if (4 * m * p >= v) return 4 * m * p;
  return 40 * p;
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amount < 0 ? c : 255 - c) * amount)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`;
}

// ---------------------------------------------------------------------------------------------------------------

export interface FunnelStep { label: string; value: number }

/** Stepped columns, each a stage that is no bigger than the one before. Hover or focus a column to read its conversion. */
export function FunnelColumns({ steps, unit, ariaLabel, height = 230 }: { steps: FunnelStep[]; unit: string; ariaLabel: string; height?: number }) {
  const n = steps.length;
  const [sel, setSel] = useState(Math.min(2, n - 1));
  const max = Math.max(...steps.map((s) => s.value), 0);
  const top = niceTop(max);
  const ticks = [1, 2, 3, 4].map((i) => (top * i) / 4);
  if (max === 0) return <p className="muted" style={{ margin: '24px 0' }}>Nothing in this range yet.</p>;
  const info = (i: number) => {
    const s = steps[i];
    const prev = i > 0 ? steps[i - 1].value : null;
    const conv = prev ? Math.round((s.value / prev) * 100) : null;
    return { conv, drop: conv === null ? null : conv - 100 };
  };
  const cur = info(sel);
  const h = (i: number) => steps[i].value / top;
  const summary = `${steps[sel].label}: ${steps[sel].value} ${unit}${cur.conv !== null ? `, ${cur.conv}% of the previous step` : ''}`;
  return (
    <div className="funnel" style={{ ['--ph' as string]: `${height}px`, ['--n' as string]: n }} role="group" aria-label={ariaLabel}>
      <div className="fplot">
        <div className="fy" aria-hidden>{ticks.map((t) => <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>{compactNum(t)}</span>)}</div>
        {steps.map((s, i) => (
          <div key={s.label} className={`fcol ${i === sel ? 'sel' : ''}`} tabIndex={0} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} aria-label={`${s.label}: ${s.value} ${unit}`}>
            <div className="fhead"><div className="n">{s.label}</div><div className="v">{compactNum(s.value)}</div></div>
            <div className="fbars">
              <div className="fmark" style={{ ['--h' as string]: h(i) }} aria-hidden />
              <div className="fbar" style={{ ['--h' as string]: h(i) }} />
              {i < n - 1 && <div className="fwedge" style={{ ['--h' as string]: h(i), ['--r' as string]: steps[i].value ? Math.min(1, steps[i + 1].value / steps[i].value) : 1 }} aria-hidden />}
            </div>
          </div>
        ))}
      </div>
      <div className="fgrid" aria-hidden>{ticks.map((t) => <i key={t} style={{ bottom: `${(t / top) * 100}%` }} />)}</div>
      <div className="ftip" aria-hidden style={{ left: `calc(44px + (100% - 44px) * ${(sel + 0.5) / n})`, top: `calc(84px + var(--ph) * ${1 - h(sel)} - 30px)` }}>
        <b>{steps[sel].value}</b> {unit}
        {cur.conv !== null && <><span className="sep">|</span>Conversion: <b>{cur.conv}%</b><span className="sep">|</span>Drop-off: <b>{cur.drop! > 0 ? '+' : cur.drop === 0 ? '' : '−'}{Math.abs(cur.drop!)}%</b></>}
      </div>
      <span className="sr" role="status">{summary}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export interface HatchRow { name: string; value: string; share: number; c1: string; c2: string }

/** A list of amounts with hatched progress bars. `share` is 0 to 1 of the track. */
export function HatchRows({ rows }: { rows: HatchRow[] }) {
  return (
    <div className="hrows">
      {rows.map((r) => (
        <div className="hrow" key={r.name}>
          <div className="top"><span>{r.name}</span><b>{r.value}</b></div>
          <div className="hbar" role="img" aria-label={`${r.name}: ${r.value}, ${Math.round(r.share * 100)}% of the largest`}>
            <span style={{ width: `${Math.max(2, Math.min(100, r.share * 100))}%`, ['--c1' as string]: r.c1, ['--c2' as string]: r.c2 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** A step line over many thin bars that fade towards the baseline. The highest step gets a dot and a label. */
export function StepLineBars({ values, labels, format, ariaLabel, color = '#f0348a' }: { values: (number | null)[]; labels: string[]; format: (n: number) => string; ariaLabel: string; color?: string }) {
  const gid = useId().replace(/:/g, '');
  const W = 300;
  const H = 290;
  const real = values.filter((v): v is number => v !== null);
  if (real.length < 2) return <p className="muted" style={{ margin: '24px 0' }}>Needs at least two months of figures.</p>;
  const n = values.length;
  const max = Math.max(...real) * 1.12 || 1;
  const y = (v: number) => H - (v / max) * (H - 12);
  const sw = W / n;
  let d = '';
  let peak = { i: 0, v: -Infinity };
  values.forEach((v, i) => {
    if (v === null) return;
    if (v > peak.v) peak = { i, v };
    const x0 = i * sw;
    const prev = values[i - 1];
    d += d === '' || prev === null || prev === undefined ? `M${x0},${y(v)} H${x0 + sw}` : ` V${y(v)} H${x0 + sw}`;
  });
  const bars = Math.round(W / 4.2);
  const bw = W / bars;
  const level = (x: number) => values[Math.min(n - 1, Math.floor(x / sw))];
  const every = n > 8 ? Math.ceil(n / 7) : 1;
  return (
    <div className="stepchart">
      <div style={{ position: 'relative', aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, height: '100%' }}>
          <defs>
            <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".34" /><stop offset="1" stopColor={color} stopOpacity=".02" /></linearGradient>
          </defs>
          {Array.from({ length: bars }, (_, k) => {
            const v = level(k * bw + bw / 2);
            return v === null || v === undefined ? null : <rect key={k} x={k * bw + 0.5} width={bw - 1.6} y={y(v)} height={H - y(v)} fill={`url(#g${gid})`} />;
          })}
          <line x1="0" x2={W} y1={H} y2={H} stroke="#d7d7db" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span style={{ position: 'absolute', left: `${((peak.i * sw) / W) * 100}%`, top: `${(y(peak.v) / H) * 100}%`, width: 9, height: 9, borderRadius: '50%', background: color, transform: 'translate(-50%,-50%)', boxShadow: '0 0 0 3px #fff' }} aria-hidden />
        <span className="peakpill" style={{ left: `${((peak.i * sw + sw / 2) / W) * 100}%`, top: `calc(${(y(peak.v) / H) * 100}% - 12px)` }}>{format(peak.v)}</span>
      </div>
      <div className="lbls" aria-hidden>{labels.map((l, i) => <span key={i} style={{ visibility: i % every === 0 ? 'visible' : 'hidden' }}>{l}</span>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A dot-matrix histogram over the days of the week. The busiest day is solid, the rest pale. */
export function DotMatrix({ counts, color, pale, ariaLabel, peakWord = 'Peak' }: { counts: number[]; color: string; pale: string; ariaLabel: string; peakWord?: string }) {
  const max = Math.max(...counts, 0);
  const [hover, setHover] = useState<number | null>(null);
  const peak = counts.indexOf(max);
  const rows = 6;
  const cell = 15;
  const W = counts.length * cell * 1.9;
  const H = rows * cell + 4;
  const dots = (c: number) => (max === 0 ? 0 : c === 0 ? 0 : Math.max(1, Math.round((c / max) * rows)));
  const shown = hover ?? peak;
  return (
    <div className="dotwrap">
      <div style={{ position: 'relative' }}>
        {max > 0 && (
          <span className="peakpill" style={{ left: `${((shown * cell * 1.9 + cell * 0.95) / W) * 100}%`, top: -2 }}>
            {hover === null ? <>{peakWord}: <b>{DAYS[peak]}</b></> : <><b>{DAYS[hover]}</b>: {counts[hover]}</>}
          </span>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} style={{ marginTop: 26 }}>
          {counts.map((c, i) => (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * cell * 1.9} y={0} width={cell * 1.9} height={H} fill="transparent" />
              {Array.from({ length: dots(c) }, (_, k) => (
                <rect key={k} x={i * cell * 1.9 + cell * 0.3} y={H - 4 - (k + 1) * cell + 2} width={cell * 1.3} height={cell * 0.86} rx={cell * 0.38} fill={i === peak ? color : pale} />
              ))}
              {c === 0 && <rect x={i * cell * 1.9 + cell * 0.3} y={H - 4 - cell + 2} width={cell * 1.3} height={cell * 0.86} rx={cell * 0.38} fill={pale} opacity=".45" />}
            </g>
          ))}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9a9aa0', marginTop: 4 }} aria-hidden>{DAYS.map((d) => <span key={d} style={{ width: `${100 / 7}%`, textAlign: 'center' }}>{d[0]}</span>)}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** The gradient card: one big figure and a one-line reading of it. `segments` light up for each measure that is fine. */
export function InsightCard({ tag, big, word, headline, body, segments }: { tag: string; big: string; word?: boolean; headline: string; body?: string; segments?: boolean[] }) {
  return (
    <section className="insight" aria-label={tag}>
      <span className="tag"><BulbIcon /> {tag}</span>
      <div className={`num ${word ? 'word' : ''}`}>{big}</div>
      <p>{headline}</p>
      {body && <small>{body}</small>}
      {segments && <div className="segs" aria-hidden>{segments.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export interface JumpItem { label: string; kind: string; href: string }

/** The frosted bar under the funnel. In v1 it is a plain search: type to find a page, goal or milestone and jump to it. */
export function JumpBar({ items, children }: { items: JumpItem[]; children?: ReactNode }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(0);
  const term = q.trim().replace(/^\//, '').toLowerCase();
  const hits = useMemo(() => (term ? items.filter((i) => `${i.label} ${i.kind}`.toLowerCase().includes(term)).slice(0, 6) : []), [items, term]);
  const go = (i: JumpItem | undefined) => i && router.push(i.href);
  return (
    <div className="prompt" role="search">
      <div className="ph"><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><SparkleIcon /> What would you like to explore next?</span>
        <button type="button" className="iconbtn sm" style={{ width: 28, height: 28, boxShadow: 'none', background: 'transparent' }} aria-expanded={open} aria-label={open ? 'Hide search' : 'Show search'} onClick={() => setOpen(!open)}><span style={{ display: 'inline-flex', transform: open ? 'none' : 'rotate(180deg)' }}><ChevronUpIcon /></span></button>
      </div>
      {open && (
        <>
          <div className="box">
            <SearchIcon width={18} height={18} />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                else if (e.key === 'Enter') go(hits[active]);
              }}
              placeholder="Find a goal, a milestone or a page"
              aria-label="Find a goal, a milestone or a page"
              role="combobox"
              aria-expanded={hits.length > 0}
              aria-controls="jump-list"
              aria-activedescendant={hits[active] ? `jump-${active}` : undefined}
            />
            {term && hits[0] && <span className="chip">/{hits[active]?.kind ?? hits[0].kind}</span>}
          </div>
          {term && (
            <ul id="jump-list" role="listbox">
              {hits.length === 0 && <li className="muted" style={{ padding: '10px 16px' }}>No match.</li>}
              {hits.map((h, i) => (
                <li key={h.href + h.label} role="option" id={`jump-${i}`} aria-selected={i === active}>
                  <button type="button" onClick={() => go(h)} aria-selected={i === active}><span>{h.label}</span><span className="k">{h.kind}</span></button>
                </li>
              ))}
            </ul>
          )}
          {children}
        </>
      )}
    </div>
  );
}
