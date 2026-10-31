'use client';
import Link from 'next/link';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronIcon, DotsIcon, LinkIcon } from './Icons';

/** Closes a popover on Escape or a click outside it. Returns the ref to put on the popover's wrapper. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open, close]);
  return ref;
}

/** The big light page title with the round "copy link" button, and a toolbar on the right. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked: nothing to do */ }
  }
  return (
    <div className="pagehead">
      <h1>
        {title}
        <button type="button" className="iconbtn" onClick={copy} aria-label="Copy link to this page" title="Copy link"><LinkIcon /></button>
        <span className="sr" role="status">{copied ? 'Link copied' : ''}</span>
        {copied && <span className="glass" style={{ fontSize: 13, fontWeight: 400, letterSpacing: 0 }}>Link copied</span>}
      </h1>
      {children}
    </div>
  );
}

export interface MenuItem { label: string; onClick?: () => void; href?: string; checked?: boolean }

/** The round "..." button in a card's corner, with a small menu. */
export function CardMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  return (
    <div className="cmenu" ref={ref}>
      <button type="button" className="iconbtn" aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: options`} onClick={() => setOpen(!open)}><DotsIcon /></button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it) => it.href
            ? <Link key={it.label} href={it.href} className="item" role="menuitem" onClick={close} style={{ textDecoration: 'none' }}>{it.label}</Link>
            : <button key={it.label} type="button" className="item" role="menuitemradio" aria-checked={!!it.checked} onClick={() => { it.onClick?.(); close(); }}>{it.label}</button>)}
        </div>
      )}
    </div>
  );
}

/** A dashboard card: title and optional sub-line on the left, the "..." menu on the right. */
export function Card({ title, sub, menu, className = '', children, id }: { title: string; sub?: string; menu?: MenuItem[]; className?: string; children: ReactNode; id?: string }) {
  const hid = `${id ?? title.replace(/\W+/g, '-').toLowerCase()}-h`;
  return (
    <section className={`card vcard ${className}`} aria-labelledby={hid}>
      <div className="card-h">
        <div><h2 id={hid}>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
        {menu && <CardMenu label={title} items={menu} />}
      </div>
      {children}
    </section>
  );
}

/** A signed change as a small pill: green up, red down. `good` says which direction is good. */
export function Delta({ value, text, goodWhen = 'up' }: { value: number; text?: string; goodWhen?: 'up' | 'down' }) {
  if (!Number.isFinite(value)) return null;
  const up = value >= 0;
  const good = goodWhen === 'up' ? up : !up;
  return <span className={`delta ${good ? 'up' : 'down'}`}><i aria-hidden>{up ? '▲' : '▼'}</i>{text ?? `${Math.abs(value)}%`}<span className="sr">{up ? ' up' : ' down'}</span></span>;
}

/** Grey pill button with a chevron, for toolbar dropdowns. */
export function DropButton({ children, open, ...rest }: { children: ReactNode; open: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="greybtn" aria-haspopup="menu" aria-expanded={open} {...rest}>{children}<ChevronIcon /></button>;
}

export interface TableData { head: string[]; rows: (string | number)[][] }

export function TableView({ table }: { table: TableData }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr>{table.head.map((h, i) => <th key={i} style={i ? { textAlign: 'right' } : undefined}>{h}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={j ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** A card whose "..." menu switches between the chart and a table with the exact numbers, and can offer links. */
export function DataCard({ title, sub, table, links = [], className, children }: { title: string; sub?: string; table: TableData; links?: { label: string; href: string }[]; className?: string; children: ReactNode }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const menu: MenuItem[] = [{ label: view === 'chart' ? 'View as table' : 'View as chart', onClick: () => setView(view === 'chart' ? 'table' : 'chart') }, ...links];
  return <Card title={title} sub={sub} menu={menu} className={className}>{view === 'chart' ? children : <TableView table={table} />}</Card>;
}
