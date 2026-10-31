'use client';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { CalendarIcon, PlusIcon } from '../Icons';
import { DropButton, useDismiss } from '../ui';

export type Preset = 'fy' | '6m' | 'all' | 'custom';
export type CompareMode = 'none' | 'yoy' | 'prev' | 'custom';
export interface RangeState { preset: Preset; from?: string; to?: string; compare: CompareMode; cFrom?: string; cTo?: string }
export const DEFAULT_RANGE: RangeState = { preset: 'fy', compare: 'yoy' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const ymLabel = (ym: string) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
export const rangeLabel = (r: { from: string; to: string }) => (r.from === r.to ? ymLabel(r.from) : `${ymLabel(r.from)} – ${ymLabel(r.to)}`);
export const addMonths = (ym: string, n: number) => {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** The chosen range, kept in the page address so "copy link" shares exactly what is on screen. */
export function useRangeState(): [RangeState, (r: RangeState) => void] {
  const [state, setState] = useState<RangeState>(DEFAULT_RANGE);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const month = (k: string) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(q.get(k) ?? '') ? q.get(k)! : undefined);
    const preset = (['fy', '6m', 'all', 'custom'] as const).find((p) => p === q.get('r')) ?? 'fy';
    const compare = (['none', 'yoy', 'prev', 'custom'] as const).find((c) => c === q.get('c')) ?? 'yoy';
    setState({ preset, from: month('from'), to: month('to'), compare, cFrom: month('cf'), cTo: month('ct') });
  }, []);
  const set = useCallback((r: RangeState) => {
    setState(r);
    const q = new URLSearchParams();
    if (r.preset !== 'fy') q.set('r', r.preset);
    if (r.from) q.set('from', r.from);
    if (r.to) q.set('to', r.to);
    if (r.compare !== 'yoy') q.set('c', r.compare);
    if (r.cFrom) q.set('cf', r.cFrom);
    if (r.cTo) q.set('ct', r.cTo);
    history.replaceState(null, '', q.size ? `?${q}` : location.pathname);
  }, []);
  return [state, set];
}

/** The API query for a range state. Presets that need the latest month are filled in from `asOf`. */
export function rangeQuery(r: RangeState): string {
  const q = new URLSearchParams();
  if (r.from) q.set('from', r.from);
  if (r.to) q.set('to', r.to);
  if (r.compare === 'yoy' || r.compare === 'prev') q.set('compare', r.compare);
  if (r.compare === 'custom' && r.cFrom && r.cTo) { q.set('compareFrom', r.cFrom); q.set('compareTo', r.cTo); }
  return q.toString();
}

function MonthPair({ from, to, min, max, onApply }: { from: string; to: string; min?: string; max?: string; onApply: (f: string, t: string) => void }) {
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  useEffect(() => { setF(from); setT(to); }, [from, to]);
  const ok = f && t && f <= t;
  return (
    <div className="custom">
      <div><label>From</label><input type="month" value={f} min={min} max={max} onChange={(e) => setF(e.target.value)} aria-label="From month" /></div>
      <div><label>To</label><input type="month" value={t} min={min} max={max} onChange={(e) => setT(e.target.value)} aria-label="To month" /></div>
      <button type="button" style={{ gridColumn: '1 / -1' }} disabled={!ok} onClick={() => ok && onApply(f, t)}>Apply</button>
    </div>
  );
}

export interface Widget { id: string; label: string }

/**
 * The toolbar of the reference: a date range, "compared to" another range, and Add widget. `range` and `available`
 * come from the API response, so the pills show the months actually being drawn.
 */
export function RangeBar({ state, onChange, range, compareRange, asOf, available, widgets, hidden, onToggleWidget, children }: {
  state: RangeState; onChange: (r: RangeState) => void;
  range: { from: string; to: string } | null; compareRange: { from: string; to: string } | null; asOf: string | null; available: { from: string; to: string } | null;
  widgets?: Widget[]; hidden?: string[]; onToggleWidget?: (id: string) => void; children?: ReactNode;
}) {
  const [open, setOpen] = useState<null | 'range' | 'compare' | 'widgets'>(null);
  const close = useCallback(() => setOpen(null), []);
  const ref = useDismiss<HTMLDivElement>(open !== null, close);
  const pick = (r: Partial<RangeState>) => { onChange({ ...state, ...r }); setOpen(null); };
  const preset = (p: Preset) => {
    if (p === 'fy') return pick({ preset: 'fy', from: undefined, to: undefined });
    if (p === '6m' && asOf) return pick({ preset: '6m', from: addMonths(asOf, -5), to: asOf });
    if (p === 'all' && available) return pick({ preset: 'all', from: available.from, to: available.to });
  };
  const tick = (on: boolean) => ({ role: 'menuitemradio' as const, 'aria-checked': on });
  return (
    <div className="toolbar" ref={ref}>
      <div className="pillgroup">
        <div style={{ position: 'relative' }}>
          <button type="button" className="seg-btn on" aria-haspopup="menu" aria-expanded={open === 'range'} onClick={() => setOpen(open === 'range' ? null : 'range')}>
            <CalendarIcon /> {range ? rangeLabel(range) : 'Choose months'} <span aria-hidden>▾</span>
          </button>
          {open === 'range' && (
            <div className="menu left" role="menu" aria-label="Date range">
              <button type="button" className="item" {...tick(state.preset === 'fy')} onClick={() => preset('fy')}>This fiscal year</button>
              <button type="button" className="item" {...tick(state.preset === '6m')} onClick={() => preset('6m')} disabled={!asOf}>Last 6 months</button>
              <button type="button" className="item" {...tick(state.preset === 'all')} onClick={() => preset('all')} disabled={!available}>All data</button>
              <hr />
              {range && <MonthPair from={range.from} to={range.to} min={available?.from} max={available?.to ? addMonths(available.to, 0) : undefined} onApply={(f, t) => pick({ preset: 'custom', from: f, to: t })} />}
            </div>
          )}
        </div>
        <span className="mid">compared to</span>
        <div style={{ position: 'relative' }}>
          <button type="button" className="seg-btn" aria-haspopup="menu" aria-expanded={open === 'compare'} onClick={() => setOpen(open === 'compare' ? null : 'compare')}>
            <CalendarIcon /> {compareRange ? rangeLabel(compareRange) : 'No comparison'} <span aria-hidden>▾</span>
          </button>
          {open === 'compare' && (
            <div className="menu" role="menu" aria-label="Compare with">
              <button type="button" className="item" {...tick(state.compare === 'yoy')} onClick={() => pick({ compare: 'yoy' })}>Same months last year</button>
              <button type="button" className="item" {...tick(state.compare === 'prev')} onClick={() => pick({ compare: 'prev' })}>The months right before</button>
              <button type="button" className="item" {...tick(state.compare === 'none')} onClick={() => pick({ compare: 'none' })}>No comparison</button>
              <hr />
              <MonthPair from={compareRange?.from ?? range?.from ?? ''} to={compareRange?.to ?? range?.to ?? ''} onApply={(f, t) => pick({ compare: 'custom', cFrom: f, cTo: t })} />
            </div>
          )}
        </div>
      </div>
      {children}
      {widgets && onToggleWidget && (
        <div style={{ position: 'relative' }}>
          <button type="button" className="greybtn" aria-haspopup="menu" aria-expanded={open === 'widgets'} onClick={() => setOpen(open === 'widgets' ? null : 'widgets')}>Add widget <PlusIcon /></button>
          {open === 'widgets' && (
            <div className="menu" role="menu" aria-label="Widgets">
              {widgets.map((w) => <button key={w.id} type="button" className="item" {...tick(!(hidden ?? []).includes(w.id))} onClick={() => onToggleWidget(w.id)}>{w.label}</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Which dashboard widgets this person has switched off. Kept in this browser only; it is just a view preference. */
export function useHiddenWidgets(key: string): [string[], (id: string) => void] {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); if (Array.isArray(v)) setHidden(v.filter((x) => typeof x === 'string')); } catch { /* no storage: show everything */ }
  }, [key]);
  const toggle = useCallback((id: string) => {
    setHidden((h) => {
      const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);
  return [hidden, toggle];
}
