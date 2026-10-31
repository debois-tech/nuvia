'use client';
import Link from 'next/link';
import { fmtDate } from '@/lib/api';
import { Goal } from '@/lib/types';

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATE_WORD = { done: 'done', overdue: 'overdue', at_risk: 'at risk', on_track: 'on track' } as const;

/** Goals as bars from start to due date, milestones as diamonds on their dates, and a line for today. */
export function GoalTimeline({ goals, today }: { goals: Goal[]; today: string }) {
  const shown = goals.filter((g) => g.status !== 'dropped');
  if (!shown.length) return <p className="muted">No goals yet.</p>;
  let lo = Math.min(t(today), ...shown.map((g) => t(g.startDate)));
  let hi = Math.max(t(today), ...shown.map((g) => t(g.dueDate)));
  if (hi - lo < 60 * DAY) hi = lo + 60 * DAY;
  const pad = (hi - lo) * 0.03;
  lo -= pad;
  hi += pad;
  const pos = (ms: number) => `${((ms - lo) / (hi - lo)) * 100}%`;

  // A tick at the first day of each month (every second or third month when it would get crowded).
  const ticks: { at: number; label: string }[] = [];
  const first = new Date(lo);
  const span = Math.round((hi - lo) / (30 * DAY));
  const step = span > 30 ? 6 : span > 16 ? 3 : span > 8 ? 2 : 1;
  for (let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)), i = 0; d.getTime() < hi; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)), i++) {
    if (i % step === 0 && (d.getTime() - lo) / (hi - lo) < 0.93) ticks.push({ at: d.getTime(), label: `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 || ticks.length === 0 ? ` ${d.getUTCFullYear()}` : ''}` });
  }

  return (
    <div className="scroll">
      <div className="gantt" role="group" aria-label="Goal timeline. The same information is in the list below.">
        <div className="head"><span>Goal</span><div className="scale">{ticks.map((k) => <span key={k.at} style={{ left: pos(k.at) }}>{k.label}</span>)}</div></div>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 200, right: 0, top: 0, bottom: 0, pointerEvents: 'none' }}>
            <div className="today" style={{ left: pos(t(today)) }}><span>Today</span></div>
          </div>
          {shown.map((g) => (
            <div className="grow" key={g.id}>
              <Link href={`/leadership/goals/${g.id}`} style={{ paddingRight: 10, overflowWrap: 'anywhere' }}>{g.title}</Link>
              <div className="lane">
                <div
                  className={`bar-g ${g.status === 'done' ? 'done' : g.health === 'off_track' ? 'off_track' : g.health === 'at_risk' ? 'at_risk' : ''}`}
                  style={{ left: pos(t(g.startDate)), width: `calc(${pos(t(g.dueDate))} - ${pos(t(g.startDate))})` }}
                  title={`${g.title}: ${fmtDate(g.startDate)} to ${fmtDate(g.dueDate)}`}
                />
                {g.milestones.map((m) => (
                  <span key={m.id} className={`ms ${m.state}`} style={{ left: pos(t(m.dueDate)) }} title={`${m.title}: ${fmtDate(m.dueDate)} (${STATE_WORD[m.state]})`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
