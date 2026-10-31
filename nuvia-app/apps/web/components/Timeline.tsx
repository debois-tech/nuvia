'use client';
import { fmtTime } from '@/lib/api';
import { Period, PeriodKind } from '@/lib/types';

const LABEL: Record<PeriodKind, string> = { active: 'Active', idle: 'Idle (confirmed present)', absent: 'Absent', offline: 'Agent offline' };

/** One bar per session, each period sized by how long it lasted. Colour is backed by a text legend and table. */
export function Timeline({ periods, now = Date.now() }: { periods: Period[]; now?: number }) {
  const spans = periods.map((p) => ({ ...p, ms: Math.max(0, (p.endedAt ? new Date(p.endedAt).getTime() : now) - new Date(p.startedAt).getTime()) }));
  const total = spans.reduce((a, s) => a + s.ms, 0) || 1;
  return (
    <div>
      <div className="bar" role="img" aria-label={spans.map((s) => `${LABEL[s.kind]} ${fmtTime(s.startedAt)}`).join(', ')}>
        {spans.map((s) => (
          <span key={s.id} className={s.kind} style={{ width: `${(s.ms / total) * 100}%` }} title={`${LABEL[s.kind]} ${fmtTime(s.startedAt)}–${fmtTime(s.endedAt)}`} />
        ))}
      </div>
      <div className="legend">
        {(Object.keys(LABEL) as PeriodKind[]).map((k) => (
          <span key={k}><i className={`${k}`} style={{ background: `var(--${k === 'active' ? 'green' : k === 'idle' ? 'amber' : k === 'absent' ? 'red' : 'grey'})` }} />{LABEL[k]}</span>
        ))}
      </div>
    </div>
  );
}

export function PeriodTable({ periods }: { periods: Period[] }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>What</th><th>From</th><th>To</th></tr></thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id}>
              <td><span className={`pill ${p.kind}`}>{LABEL[p.kind]}</span></td>
              <td>{fmtTime(p.startedAt)}</td>
              <td>{p.endedAt ? fmtTime(p.endedAt) : 'now'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
