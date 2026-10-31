'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useRef, useState } from 'react';
import { Shell } from '@/components/Shell';
import { LinkedGoals } from '@/components/leadership/LinkedGoals';
import { Due, PriorityPill, ref, StatusPill } from '@/components/TaskBits';
import { api, fmtBytes, fmtDate, fmtDateTime, uploadFile, useApi } from '@/lib/api';
import { Me, PRIORITIES, PRIORITY_LABEL, ProjectDetail, STATUS_LABEL, STATUSES, TaskDetail, TaskStatus } from '@/lib/types';

function historyText(a: TaskDetail['activity'][number], who: (id: unknown) => string): string {
  const d = a.detail;
  switch (a.kind) {
    case 'created': return `created the task${d.assigneeId ? ` and assigned it to ${who(d.assigneeId)}` : ''}`;
    case 'status_changed': return `moved it from ${STATUS_LABEL[d.from as TaskStatus]} to ${STATUS_LABEL[d.to as TaskStatus]}`;
    case 'assigned': return d.to ? `assigned it to ${who(d.to)}${d.from ? ` (was ${who(d.from)})` : ''}` : `unassigned it (was ${who(d.from)})`;
    case 'priority_changed': return `changed priority from ${d.from} to ${d.to}`;
    case 'due_changed': return `changed the due date from ${d.from ? fmtDate(d.from) : 'none'} to ${d.to ? fmtDate(d.to) : 'none'}`;
    case 'title_changed': return `renamed it from “${d.from}”`;
    case 'description_changed': return 'edited the description';
    case 'commented': return 'added a comment';
    case 'attachment_added': return `attached ${d.name}`;
    case 'attachment_removed': return `removed ${d.name}`;
    default: return a.kind.replace(/_/g, ' ');
  }
}

function Body({ id, me }: { id: string; me: Me }) {
  const { data: t, error, reload } = useApi<TaskDetail>(`tasks/${id}`);
  const project = useApi<ProjectDetail>(t ? `projects/${t.projectId}` : null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<unknown>) {
    setErr('');
    setBusy(true);
    try { await fn(); await reload(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  const patch = (body: object) => run(() => api(`tasks/${id}`, { method: 'PATCH', body }));

  if (error) return <p className="err" role="alert">{error}</p>;
  if (!t) return <p className="muted">Loading…</p>;
  const members = project.data?.members ?? [];
  const who = (uid: unknown) => members.find((m) => m.id === uid)?.name ?? 'someone';

  async function comment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get('body') ?? '');
    await run(async () => { await api(`tasks/${id}/comments`, { body: { body } }); form.reset(); });
  }
  async function attach(files: FileList | null) {
    if (!files?.length) return;
    await run(async () => { for (const f of Array.from(files)) await uploadFile(`tasks/${id}/attachments`, f); });
    if (fileRef.current) fileRef.current.value = '';
  }
  async function addSub(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get('title') ?? '');
    await run(async () => {
      await api('tasks', { body: { projectId: t!.projectId, title, parentId: t!.id, assigneeId: t!.assignee?.id ?? null } });
      form.reset();
      setAddingSub(false);
    });
  }

  return (
    <>
      <p className="muted" style={{ margin: '0 0 4px' }}>
        <Link href={`/projects/${t.projectId}`}>{t.projectName}</Link>
        {t.parent && <> › <Link href={`/tasks/${t.parent.id}`}>{t.parent.projectKey}-{t.parent.number}</Link></>}
      </p>
      {editing && t.can.edit ? (
        <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void patch({ title: f.get('title'), description: f.get('description') }).then(() => setEditing(false)); }}>
          <label htmlFor="e-title">Title</label><input id="e-title" name="title" defaultValue={t.title} required maxLength={200} style={{ width: '100%' }} />
          <label htmlFor="e-desc">Description</label><textarea id="e-desc" name="description" defaultValue={t.description} maxLength={20000} style={{ minHeight: 140 }} />
          <p className="row"><button type="submit" disabled={busy}>Save</button><button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button></p>
        </form>
      ) : (
        <div className="row spread" style={{ alignItems: 'start' }}>
          <h1>{ref(t)} · {t.title}</h1>
          {t.can.edit && <button className="secondary" onClick={() => setEditing(true)}>Edit</button>}
        </div>
      )}
      {t.projectArchived && <p className="muted">This project is archived, so the task is read-only.</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <LinkedGoals goals={t.goals} />

      <div className="twocol">
        <div>
          {!editing && (
            <section className="card" aria-labelledby="d-h">
              <h2 id="d-h">Description</h2>
              {t.description ? <p className="prewrap">{t.description}</p> : <p className="muted">No description.</p>}
            </section>
          )}

          {!t.parent && (
            <section className="card" aria-labelledby="s-h">
              <div className="row spread"><h2 id="s-h">Sub-tasks {t.subtasks.length > 0 && <span className="muted">{t.subtasks.filter((s) => s.status === 'done').length}/{t.subtasks.length}</span>}</h2>
                {t.can.edit && <button className="secondary" onClick={() => setAddingSub(!addingSub)}>Add sub-task</button>}</div>
              {t.subtasks.length === 0 && !addingSub && <p className="muted">None.</p>}
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {t.subtasks.map((s) => (
                  <li key={s.id}><Link href={`/tasks/${s.id}`}>{t.projectKey}-{s.number} {s.title}</Link> <StatusPill s={s.status} /> <span className="muted">{s.assigneeName ?? 'Unassigned'}</span></li>
                ))}
              </ul>
              {addingSub && (
                <form className="row" style={{ marginTop: 10 }} onSubmit={addSub}>
                  <label htmlFor="sub-title" className="muted" style={{ margin: 0 }}>Title</label>
                  <input id="sub-title" name="title" required maxLength={200} style={{ flex: 1, minWidth: 200 }} /><button type="submit" disabled={busy}>Add</button>
                </form>
              )}
            </section>
          )}

          <section className="card" aria-labelledby="a-h">
            <h2 id="a-h">Files</h2>
            {t.attachments.length === 0 && <p className="muted">No files attached.</p>}
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {t.attachments.map((a) => (
                <li key={a.id} style={{ margin: '4px 0' }}>
                  <a href={`/api/tasks/attachments/${a.id}`} download>{a.fileName}</a>{' '}
                  <span className="muted">{fmtBytes(a.sizeBytes)} · {a.uploaderName} · {fmtDateTime(a.createdAt)}</span>{' '}
                  {a.canRemove && <button className="secondary" style={{ padding: '2px 10px' }} disabled={busy} aria-label={`Remove ${a.fileName}`}
                    onClick={() => { if (confirm(`Remove ${a.fileName}?`)) void run(() => api(`tasks/attachments/${a.id}`, { method: 'DELETE' })); }}>Remove</button>}
                </li>
              ))}
            </ul>
            {t.can.attach && (
              <p><label htmlFor="file" style={{ display: 'inline' }}>Attach files</label>{' '}
                <input id="file" ref={fileRef} type="file" multiple disabled={busy} onChange={(e) => void attach(e.target.files)} /></p>
            )}
          </section>

          <section className="card" aria-labelledby="c-h">
            <h2 id="c-h">Comments</h2>
            {t.comments.length === 0 && <p className="muted">No comments yet.</p>}
            {t.comments.map((c) => (
              <div className="comment" key={c.id}>
                <b>{c.authorName}</b> <span className="muted" style={{ fontSize: 13 }}>{fmtDateTime(c.createdAt)}</span>
                <div className="prewrap">{c.body}</div>
              </div>
            ))}
            {t.can.comment && (
              <form onSubmit={comment}>
                <label htmlFor="c-body">Add a comment</label>
                <textarea id="c-body" name="body" required maxLength={5000} />
                <p><button type="submit" disabled={busy}>Comment</button></p>
              </form>
            )}
          </section>

          <section className="card" aria-labelledby="h-h">
            <h2 id="h-h">History</h2>
            <ul className="hist">
              {[...t.activity].reverse().map((a) => <li key={a.id}><b>{a.actorName ?? 'Someone'}</b> {historyText(a, who)} · {fmtDateTime(a.createdAt)}</li>)}
            </ul>
          </section>
        </div>

        <aside className="card field" aria-label="Details">
          <label htmlFor="d-status">Status</label>
          {t.can.changeStatus
            ? <select id="d-status" value={t.status} disabled={busy} onChange={(e) => void patch({ status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            : <div><StatusPill s={t.status} /></div>}
          <label htmlFor="d-assignee">Assignee</label>
          {t.can.edit
            ? <select id="d-assignee" value={t.assignee?.id ?? ''} disabled={busy} onChange={(e) => void patch({ assigneeId: e.target.value || null })}>
                <option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            : <div>{t.assignee ? (t.assignee.id === me.id ? 'You' : t.assignee.name) : <span className="muted">Unassigned</span>}</div>}
          <label htmlFor="d-pri">Priority</label>
          {t.can.edit
            ? <select id="d-pri" value={t.priority} disabled={busy} onChange={(e) => void patch({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
            : <div><PriorityPill p={t.priority} /></div>}
          <label htmlFor="d-due">Due date</label>
          {t.can.edit
            ? <input id="d-due" type="date" value={t.dueDate ?? ''} disabled={busy} onChange={(e) => void patch({ dueDate: e.target.value || null })} />
            : <div><Due date={t.dueDate} overdue={t.overdue} /></div>}
          {t.can.edit && t.overdue && <p className="err" style={{ margin: '6px 0 0' }}>Overdue</p>}
          <label>Reporter</label><div>{t.reporter?.name ?? '–'}</div>
          <label>Created</label><div>{fmtDateTime(t.createdAt)}</div>
          {t.completedAt && <><label>Completed</label><div>{fmtDateTime(t.completedAt)}</div></>}
        </aside>
      </div>
    </>
  );
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  return <Shell>{(me) => <Body id={id} me={me} />}</Shell>;
}
