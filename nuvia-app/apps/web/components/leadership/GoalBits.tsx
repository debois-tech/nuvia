'use client';
import { StatusBadge } from '@/components/charts/Cards';
import { Goal } from '@/lib/types';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div className="progress" role="img" aria-label={`${label}: ${done} of ${total}`}><span style={{ width: `${pct(done, total)}%` }} /></div>
      <div className="muted" style={{ fontSize: 12 }}>{total ? `${done} of ${total} ${label}` : `No ${label}`}</div>
    </div>
  );
}

export function GoalBadge({ g }: { g: Pick<Goal, 'status' | 'health'> }) {
  if (g.status === 'done') return <span className="sbadge" style={{ color: '#006300', borderColor: '#0ca30c' }}><span aria-hidden>✓</span> Done</span>;
  if (g.status === 'dropped') return <span className="sbadge muted">Dropped</span>;
  return g.health ? <StatusBadge status={g.health} /> : null;
}
