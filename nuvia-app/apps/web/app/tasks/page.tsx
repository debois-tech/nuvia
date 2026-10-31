'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Due, PriorityPill, ref, StatusPill, TaskCard } from '@/components/TaskBits';
import { api, useApi } from '@/lib/api';
import { canManageWork, Me, PRIORITIES, PRIORITY_LABEL, ProjectDetail, ProjectSummary, STATUS_LABEL, STATUSES, TaskRow, TaskStatus } from '@/lib/types';

function NewTask({ projects, initialProject, onCreated }: { projects: ProjectSummary[]; initialProject: string; onCreated: (id: string) => void }) {
  const [projectId, setProjectId] = useState(initialProject || projects[0]?.id || '');
  const detail = useApi<ProjectDetail>(projectId ? `projects/${projectId}` : null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setErr('');
    try {
      const t = await api<{ id: string }>('tasks', {
        body: {
          projectId,
          title: f.get('title'),
          description: f.get('description') || '',
          priority: f.get('priority'),
          assigneeId: f.get('assigneeId') || null,
          dueDate: f.get('dueDate') || null,
        },
      });
      form.reset();
      onCreated(t.id);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="new-h">
      <h2 id="new-h">New task</h2>
      <form onSubmit={submit}>
        <div className="formgrid">
          <div className="wide"><label htmlFor="nt-title">Title</label><input id="nt-title" name="title" required maxLength={200} style={{ width: '100%' }} /></div>
          <div><label htmlFor="nt-project">Project</label>
            <select id="nt-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ width: '100%' }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
            </select></div>
          <div><label htmlFor="nt-assignee">Assign to</label>
            <select id="nt-assignee" name="assigneeId" style={{ width: '100%' }} defaultValue="">
              <option value="">Unassigned</option>
              {detail.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
          <div><label htmlFor="nt-pri">Priority</label>
            <select id="nt-pri" name="priority" defaultValue="medium" style={{ width: '100%' }}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></div>
          <div><label htmlFor="nt-due">Due date</label><input id="nt-due" name="dueDate" type="date" style={{ width: '100%' }} /></div>
          <div className="wide"><label htmlFor="nt-desc">Description (optional)</label><textarea id="nt-desc" name="description" maxLength={20000} /></div>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <p><button type="submit" disabled={busy || !projectId}>{busy ? 'Creating…' : 'Create task'}</button></p>
      </form>
    </section>
  );
}

function Inner({ me }: { me: Me }) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [assignee, setAssignee] = useState(me.role === 'employee' ? 'me' : '');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'priority' | 'due' | 'updated'>('priority');
  const [showNew, setShowNew] = useState(false);
  const [moveErr, setMoveErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);

  const projects = useApi<ProjectSummary[]>('projects');
  const qs = new URLSearchParams({
    ...(projectId ? { projectId } : {}), ...(assignee ? { assignee } : {}), ...(due ? { due } : {}),
    ...(priority ? { priority } : {}), ...(view === 'list' && status ? { status } : {}), ...(q ? { q } : {}),
  }).toString();
  const tasks = useApi<TaskRow[]>(`tasks${qs ? `?${qs}` : ''}`, 60_000);

  const projectById = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p])), [projects.data]);
  const managed = (projects.data ?? []).filter((p) => !p.archivedAt && (me.role === 'hr_admin' || p.memberRole === 'lead') && canManageWork(me.role));
  // The server decides; this only decides whether to show the control.
  const canMove = (t: TaskRow) => me.role !== 'executive' && (t.mine || me.role === 'hr_admin' || (me.role === 'team_lead' && projectById.get(t.projectId)?.memberRole === 'lead'));

  async function move(id: string, to: TaskStatus) {
    setBusyId(id);
    setMoveErr('');
    try {
      await api(`tasks/${id}`, { method: 'PATCH', body: { status: to } });
      await tasks.reload();
    } catch (x) {
      setMoveErr((x as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const rows = tasks.data ?? [];
  const sorted = useMemo(() => {
    const rank = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
    const r = [...rows];
    if (sort === 'due') r.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    else if (sort === 'updated') r.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else r.sort((a, b) => rank[a.priority] - rank[b.priority] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    return r;
  }, [rows, sort]);

  return (
    <>
      <div className="row spread">
        <h1>Tasks</h1>
        <div className="row">
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button>
            <button aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          </div>
          {managed.length > 0 && <button onClick={() => setShowNew(!showNew)} aria-expanded={showNew}>New task</button>}
        </div>
      </div>

      {showNew && managed.length > 0 && (
        <NewTask projects={managed} initialProject={managed.some((p) => p.id === projectId) ? projectId : ''} onCreated={(id) => router.push(`/tasks/${id}`)} />
      )}

      <section className="card" aria-label="Filters and tasks">
        <div className="filters">
          <div><label htmlFor="f-q">Search</label><input id="f-q" type="search" placeholder="Title or WEB-12" value={text} onChange={(e) => setText(e.target.value)} /></div>
          <div><label htmlFor="f-project">Project</label>
            <select id="f-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
            </select></div>
          <div><label htmlFor="f-assignee">Assignee</label>
            <select id="f-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Anyone</option><option value="me">Assigned to me</option><option value="none">Unassigned</option>
            </select></div>
          <div><label htmlFor="f-due">Due</label>
            <select id="f-due" value={due} onChange={(e) => setDue(e.target.value)}>
              <option value="">Any time</option><option value="overdue">Overdue</option><option value="soon">Due soon</option><option value="none">No due date</option>
            </select></div>
          <div><label htmlFor="f-pri">Priority</label>
            <select id="f-pri" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Any</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select></div>
          {view === 'list' && (
            <>
              <div><label htmlFor="f-status">Status</label>
                <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Any</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select></div>
              <div><label htmlFor="f-sort">Sort by</label>
                <select id="f-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="priority">Priority</option><option value="due">Due date</option><option value="updated">Recently updated</option>
                </select></div>
            </>
          )}
        </div>
        {tasks.error && <p className="err" role="alert">{tasks.error}</p>}
        {moveErr && <p className="err" role="alert">{moveErr}</p>}
        {tasks.loading && !tasks.data && <p className="muted">Loading…</p>}
        {projects.data?.length === 0 && <p className="muted">You aren’t on any project yet. A team lead adds people to projects.</p>}
        {tasks.data && rows.length >= 300 && <p className="muted">Showing the first 300 tasks. Narrow the filters to see others.</p>}

        {view === 'board' ? (
          <div className="board">
            {STATUSES.map((s) => {
              const col = sorted.filter((t) => t.status === s);
              return (
                <div
                  key={s}
                  className={`col ${over === s ? 'over' : ''}`}
                  aria-label={`${STATUS_LABEL[s]}, ${col.length} tasks`}
                  onDragOver={(e) => { e.preventDefault(); setOver(s); }}
                  onDragLeave={() => setOver((o) => (o === s ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    const id = e.dataTransfer.getData('text/plain');
                    const t = rows.find((x) => x.id === id);
                    if (t && t.status !== s && canMove(t)) void move(id, s);
                  }}
                >
                  <h2><span>{STATUS_LABEL[s]}</span><span className="muted">{col.length}</span></h2>
                  {col.map((t) => <TaskCard key={t.id} t={t} canMove={canMove(t)} busy={busyId === t.id} onMove={(to) => void move(t.id, to)} />)}
                  {col.length === 0 && <p className="muted" style={{ fontSize: 13, margin: '6px' }}>Nothing here.</p>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead><tr><th>Task</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Due</th></tr></thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap' }}><Link href={`/tasks/${t.id}`}>{ref(t)}</Link></td>
                    <td>{t.title}{t.parentNumber ? <span className="muted"> · sub-task of {t.projectKey}-{t.parentNumber}</span> : null}</td>
                    <td><StatusPill s={t.status} /></td>
                    <td><PriorityPill p={t.priority} /></td>
                    <td>{t.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><Due date={t.dueDate} overdue={t.overdue} /></td>
                  </tr>
                ))}
                {tasks.data && rows.length === 0 && <tr><td colSpan={6} className="muted">No tasks match.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 13 }}>{me.role === 'executive' ? 'Read-only view.' : view === 'board' ? 'Drag a card, or use its status menu, to move it. You can move tasks assigned to you.' : ''}</p>
      </section>
    </>
  );
}

export default function TasksPage() {
  return <Shell>{(me) => <Suspense fallback={null}><Inner me={me} /></Suspense>}</Shell>;
}
