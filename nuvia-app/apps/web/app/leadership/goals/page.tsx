'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { GoalBadge, Progress } from '@/components/leadership/GoalBits';
import { GoalTimeline } from '@/components/leadership/GoalTimeline';
import { ExecOnly, LeadershipNav } from '@/components/leadership/Parts';
import { Shell } from '@/components/Shell';
import { api, fmtDate, useApi } from '@/lib/api';
import { Goal, GoalList, Person } from '@/lib/types';

function Goals() {
  const { data, error, reload } = useApi<GoalList>('leadership/goals', 60_000);
  const people = useApi<(Person & { role: string })[]>('leadership/people');
  const [err, setErr] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setErr('');
    try {
      await api('leadership/goals', { body: { title: f.get('title'), description: f.get('description') || '', ownerId: f.get('ownerId') || null, startDate: f.get('startDate'), dueDate: f.get('dueDate') } });
      form.reset();
      await reload();
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  const list = data?.goals.filter((g) => showClosed || g.status === 'active') ?? [];
  return (
    <>
      {error && <p className="err" role="alert">{error}</p>}
      {data && (
        <>
          <section className="card" aria-labelledby="tl-h">
            <h2 id="tl-h">Timeline</h2>
            <GoalTimeline goals={data.goals} today={data.today} />
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Bars are goals (blue: on track, amber: at risk, red: off track, green: done). Diamonds are milestones, coloured the same way. Hover for dates; the table below has the words.</p>
          </section>
          <section className="card" aria-labelledby="gl-h">
            <div className="row spread">
              <h2 id="gl-h">Goals</h2>
              <label style={{ margin: 0, color: 'inherit' }}><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show done and dropped</label>
            </div>
            <div className="scroll"><table>
              <thead><tr><th>Goal</th><th>Status</th><th>Owner</th><th>Dates</th><th>Milestones</th><th>Linked work</th></tr></thead>
              <tbody>
                {list.map((g) => (
                  <tr key={g.id}>
                    <td><Link href={`/leadership/goals/${g.id}`}>{g.title}</Link></td>
                    <td><GoalBadge g={g} /></td>
                    <td>{g.ownerName ?? <span className="muted">–</span>}</td>
                    <td>{fmtDate(g.startDate)} to {fmtDate(g.dueDate)}</td>
                    <td><Progress done={g.progress.milestonesDone} total={g.progress.milestonesTotal} label="milestones" /></td>
                    <td><Progress done={g.progress.tasksDone} total={g.progress.tasksTotal} label="tasks" /></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={6} className="muted">No goals yet. Add the first one below.</td></tr>}
              </tbody>
            </table></div>
          </section>
        </>
      )}
      <section className="card" aria-labelledby="ng-h">
        <h2 id="ng-h">New goal</h2>
        <form onSubmit={create}>
          <div className="formgrid">
            <div className="wide"><label htmlFor="g-title">Goal</label><input id="g-title" name="title" required maxLength={200} style={{ width: '100%' }} /></div>
            <div><label htmlFor="g-start">Starts</label><input id="g-start" name="startDate" type="date" required style={{ width: '100%' }} /></div>
            <div><label htmlFor="g-due">Due</label><input id="g-due" name="dueDate" type="date" required style={{ width: '100%' }} /></div>
            <div><label htmlFor="g-owner">Owner</label>
              <select id="g-owner" name="ownerId" style={{ width: '100%' }} defaultValue=""><option value="">No owner</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.orgId})</option>)}</select>
            </div>
            <div className="wide"><label htmlFor="g-desc">Description (optional)</label><textarea id="g-desc" name="description" maxLength={5000} /></div>
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          <p><button type="submit">Create goal</button></p>
        </form>
      </section>
    </>
  );
}

export default function GoalsPage() {
  return (
    <Shell>
      {(me) => (
        <ExecOnly me={me}>
          <h1>Goals and timeline</h1>
          <LeadershipNav />
          <Goals />
        </ExecOnly>
      )}
    </Shell>
  );
}
