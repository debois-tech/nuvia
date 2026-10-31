import { fmtDate } from '@/lib/api';
import { LinkedGoal } from '@/lib/types';

/** Which company goals a project or task serves. Titles and dates only: nothing else from the leadership area. */
export function LinkedGoals({ goals }: { goals: LinkedGoal[] }) {
  if (!goals.length) return null;
  return (
    <section className="card" aria-labelledby="lg-h" style={{ padding: '14px 20px' }}>
      <h2 id="lg-h" style={{ marginBottom: 6 }}>Serves company {goals.length === 1 ? 'goal' : 'goals'}</h2>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {goals.map((g, i) => (
          <li key={`${g.goalId}-${g.milestone?.id ?? i}`}>
            <b style={{ fontWeight: 600 }}>{g.title}</b> <span className="muted">due {fmtDate(g.dueDate)}</span>
            {g.milestone && <> · milestone <b style={{ fontWeight: 600 }}>{g.milestone.title}</b> <span className="muted">due {fmtDate(g.milestone.dueDate)}</span></>}
          </li>
        ))}
      </ul>
    </section>
  );
}
