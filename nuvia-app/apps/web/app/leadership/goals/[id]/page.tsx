'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { GoalBadge, Progress } from '@/components/leadership/GoalBits';
import { ExecOnly } from '@/components/leadership/Parts';
import { Shell } from '@/components/Shell';
import { api, fmtDate, useApi } from '@/lib/api';
import { GoalDetail, GoalLink, Milestone, Person, ProjectSummary, STATUS_LABEL, TaskRow } from '@/lib/types';

const MS_STATE = {
  done: { icon: '✓', label: 'Done', color: '#0ca30c', text: '#006300' },
  overdue: { icon: '✕', label: 'Overdue', color: '#d03b3b', text: '#a82b2b' },
  at_risk: { icon: '▲', label: 'At risk', color: '#fab219', text: '#8a5a00' },
  on_track: { icon: '•', label: 'On track', color: '#898781', text: '#52514e' },
} as const;

function MsBadge({ m }: { m: Milestone }) {
  const s = MS_STATE[m.state];
  return <span className="sbadge" style={{ color: s.text, borderColor: s.color }}><span aria-hidden>{s.icon}</span> {s.label}</span>;
}

function Detail({ id }: { id: string }) {
  const { data: g, error, reload } = useApi<GoalDetail>(`leadership/goals/${id}`);
  const people = useApi<(Person & { role: string })[]>('leadership/people');
  const projects = useApi<ProjectSummary[]>('projects');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<TaskRow[] | null>(null);
  const [scope, setScope] = useState('');

  async function act(fn: () => Promise<unknown>) {
    setErr('');
    try { await fn(); await reload(); } catch (x) { setErr((x as Error).message); }
  }
  const patch = (body: object) => act(() => api(`leadership/goals/${id}`, { method: 'PATCH', body }));

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act(async () => {
      await api(`leadership/goals/${id}`, { method: 'PATCH', body: { title: f.get('title'), description: f.get('description') || '', ownerId: f.get('ownerId') || null, startDate: f.get('startDate'), dueDate: f.get('dueDate') } });
      setEditing(false);
    });
  }
  async function addMilestone(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await act(async () => {
      await api(`leadership/goals/${id}/milestones`, { body: { title: f.get('title'), dueDate: f.get('dueDate'), ownerId: f.get('ownerId') || null } });
      form.reset();
    });
  }
  const link = (body: object) => act(() => api(`leadership/goals/${id}/links`, { body: { ...body, milestoneId: scope || null } }));
  async function search(e: FormEvent) {
    e.preventDefault();
    setErr('');
    try { setFound(await api<TaskRow[]>(`tasks?${new URLSearchParams({ q, limit: '10' })}`)); } catch (x) { setErr((x as Error).message); }
  }

  if (error) return <p className="err" role="alert">{error}</p>;
  if (!g) return <p className="muted">Loading…</p>;
  const open = g.status === 'active';
  const scopeName = (l: GoalLink) => (l.milestoneId ? g.milestones.find((m) => m.id === l.milestoneId)?.title ?? 'A milestone' : 'Whole goal');
  const ownerOptions = (
    <>
      <option value="">No owner</option>
      {people.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.orgId})</option>)}
    </>
  );

  return (
    <>
      <p><Link href="/leadership/goals">← All goals</Link></p>
      {err && <p className="err" role="alert">{err}</p>}
      <section className="card" aria-labelledby="gd-h">
        <div className="row spread" style={{ alignItems: 'start' }}>
          <div>
            <h1 id="gd-h" style={{ margin: '0 0 6px' }}>{g.title}</h1>
            <div className="row" style={{ gap: 10 }}><GoalBadge g={g} /><span className="muted">{fmtDate(g.startDate)} to {fmtDate(g.dueDate)}</span><span className="muted">Owner: {g.ownerName ?? 'none'}</span></div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="secondary" onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? 'Cancel' : 'Edit'}</button>
            {open && <button type="button" className="secondary" onClick={() => patch({ status: 'done' })}>Mark done</button>}
            {open && <button type="button" className="secondary" onClick={() => confirm('Drop this goal? It leaves the timeline and the company health, and its alerts stop.') && patch({ status: 'dropped' })}>Drop</button>}
            {!open && <button type="button" onClick={() => patch({ status: 'active' })}>Reopen</button>}
          </div>
        </div>
        {g.description && <p className="prewrap">{g.description}</p>}
        <div className="row" style={{ gap: 24 }}>
          <Progress done={g.progress.milestonesDone} total={g.progress.milestonesTotal} label="milestones" />
          <Progress done={g.progress.tasksDone} total={g.progress.tasksTotal} label="tasks" />
        </div>
        {editing && (
          <form onSubmit={save} style={{ marginTop: 12 }}>
            <div className="formgrid">
              <div className="wide"><label htmlFor="e-title">Goal</label><input id="e-title" name="title" defaultValue={g.title} required maxLength={200} style={{ width: '100%' }} /></div>
              <div><label htmlFor="e-start">Starts</label><input id="e-start" name="startDate" type="date" defaultValue={g.startDate} required style={{ width: '100%' }} /></div>
              <div><label htmlFor="e-due">Due</label><input id="e-due" name="dueDate" type="date" defaultValue={g.dueDate} required style={{ width: '100%' }} /></div>
              <div><label htmlFor="e-owner">Owner</label><select id="e-owner" name="ownerId" style={{ width: '100%' }} defaultValue={g.ownerId ?? ''}>{ownerOptions}</select></div>
              <div className="wide"><label htmlFor="e-desc">Description</label><textarea id="e-desc" name="description" defaultValue={g.description} maxLength={5000} /></div>
            </div>
            <p><button type="submit">Save</button></p>
          </form>
        )}
      </section>

      <section className="card" aria-labelledby="ms-h">
        <h2 id="ms-h">Milestones</h2>
        <div className="scroll"><table>
          <thead><tr><th>Milestone</th><th>Due</th><th>Status</th><th>Owner</th><th>Linked work</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>
            {g.milestones.map((m) => (
              <tr key={m.id}>
                <td>{m.title}{m.suggestDone && <div className="muted" style={{ fontSize: 12 }}>All linked work is done. Mark the milestone done if it is.</div>}</td>
                <td>{fmtDate(m.dueDate)}{m.state !== 'done' && <div className="muted" style={{ fontSize: 12 }}>{m.daysLeft < 0 ? `${-m.daysLeft} days ago` : m.daysLeft === 0 ? 'today' : `in ${m.daysLeft} days`}</div>}</td>
                <td><MsBadge m={m} /></td>
                <td>{m.ownerName ?? <span className="muted">–</span>}</td>
                <td><Progress done={m.tasksDone} total={m.tasksTotal} label="tasks" /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {open && <button type="button" className="secondary" onClick={() => act(() => api(`leadership/milestones/${m.id}`, { method: 'PATCH', body: { done: !m.doneAt } }))}>{m.doneAt ? 'Reopen' : 'Mark done'}</button>}{' '}
                  {open && <button type="button" className="secondary" onClick={() => confirm(`Delete the milestone "${m.title}"? Work linked to it is unlinked.`) && act(() => api(`leadership/milestones/${m.id}`, { method: 'DELETE' }))}>Delete</button>}
                </td>
              </tr>
            ))}
            {g.milestones.length === 0 && <tr><td colSpan={6} className="muted">No milestones yet.</td></tr>}
          </tbody>
        </table></div>
        {open && (
          <form onSubmit={addMilestone} style={{ marginTop: 12 }}>
            <div className="formgrid">
              <div><label htmlFor="m-title">New milestone</label><input id="m-title" name="title" required maxLength={200} style={{ width: '100%' }} /></div>
              <div><label htmlFor="m-due">Due (within the goal's dates)</label><input id="m-due" name="dueDate" type="date" required min={g.startDate} max={g.dueDate} style={{ width: '100%' }} /></div>
              <div><label htmlFor="m-owner">Owner</label><select id="m-owner" name="ownerId" style={{ width: '100%' }} defaultValue="">{ownerOptions}</select></div>
            </div>
            <p><button type="submit">Add milestone</button></p>
          </form>
        )}
      </section>

      <section className="card" aria-labelledby="lk-h">
        <h2 id="lk-h">Linked work</h2>
        <p className="muted" style={{ marginTop: 0 }}>Link a whole team project or single tasks. Their progress rolls up here, and people on that work see which goal it serves.</p>
        <div className="scroll"><table>
          <thead><tr><th>Work</th><th>Counts towards</th><th>Progress</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>
            {g.links.map((l) => (
              <tr key={l.id}>
                <td>{l.kind === 'project'
                  ? <><Link href={`/projects/${l.projectId}`}>{l.key}: {l.name}</Link> <span className="muted">project{l.archived && ', archived'}</span></>
                  : <><Link href={`/tasks/${l.taskId}`}>{l.ref}: {l.title}</Link> <span className="muted">task{l.assignee && `, ${l.assignee}`}</span></>}</td>
                <td>{scopeName(l)}</td>
                <td>{l.kind === 'project' ? `${l.doneTasks} of ${l.doneTasks + l.openTasks} tasks done` : STATUS_LABEL[l.status]}</td>
                <td>{open && <button type="button" className="secondary" onClick={() => act(() => api(`leadership/goals/${id}/links/${l.id}`, { method: 'DELETE' }))}>Unlink</button>}</td>
              </tr>
            ))}
            {g.links.length === 0 && <tr><td colSpan={4} className="muted">Nothing linked yet.</td></tr>}
          </tbody>
        </table></div>
        {open && (
          <div style={{ marginTop: 14 }}>
            <div className="row" style={{ gap: 16, alignItems: 'end' }}>
              <div>
                <label htmlFor="l-scope">Counts towards</label>
                <select id="l-scope" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Whole goal</option>{g.milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
              </div>
              <div>
                <label htmlFor="l-proj">Link a project</label>
                <select id="l-proj" value="" onChange={(e) => e.target.value && link({ projectId: e.target.value })}>
                  <option value="">Choose a project…</option>
                  {projects.data?.filter((p) => !p.archivedAt).map((p) => <option key={p.id} value={p.id}>{p.key}: {p.name}</option>)}
                </select>
              </div>
              <form onSubmit={search} className="row" style={{ gap: 8, alignItems: 'end' }}>
                <div><label htmlFor="l-q">Find a task</label><input id="l-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="WEB-12 or words" maxLength={100} /></div>
                <button type="submit" className="secondary">Search</button>
              </form>
            </div>
            {found && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
                {found.length === 0 && <li className="muted">No tasks match.</li>}
                {found.map((t) => (
                  <li key={t.id} className="row spread" style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}>
                    <span>{t.projectKey}-{t.number}: {t.title} <span className="muted">· {STATUS_LABEL[t.status]}</span></span>
                    <button type="button" className="secondary" onClick={() => link({ taskId: t.id })}>Link</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </>
  );
}

export default function GoalPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Shell>
      {(me) => (
        <ExecOnly me={me}>
          <Detail id={id} />
        </ExecOnly>
      )}
    </Shell>
  );
}
