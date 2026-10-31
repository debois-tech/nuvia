'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Shell } from '@/components/Shell';
import { api, useApi } from '@/lib/api';
import { ProjectDetail } from '@/lib/types';

interface DirEntry { id: string; orgId: string; name: string; role: string }

function Body({ id }: { id: string }) {
  const { data: p, error, reload } = useApi<ProjectDetail>(`projects/${id}`);
  const dir = useApi<DirEntry[]>(p?.access.manage ? 'projects/directory' : null);
  const [err, setErr] = useState('');
  const [role, setRole] = useState<'member' | 'lead'>('member');

  async function run(fn: () => Promise<unknown>) {
    setErr('');
    try { await fn(); await reload(); } catch (x) { setErr((x as Error).message); }
  }
  if (error) return <p className="err" role="alert">{error}</p>;
  if (!p) return <p className="muted">Loading…</p>;
  const memberIds = new Set(p.members.map((m) => m.id));
  const addable = (dir.data ?? []).filter((d) => !memberIds.has(d.id) && (role === 'member' || d.role !== 'employee'));
  const manage = p.access.manage;

  return (
    <>
      <p><Link href="/projects">← Projects</Link></p>
      <h1>{p.key} · {p.name}{p.archivedAt && <span className="muted"> (archived)</span>}</h1>
      {p.description && <p className="prewrap">{p.description}</p>}
      <p><Link href={`/tasks?project=${p.id}`}>View tasks</Link></p>
      {err && <p className="err" role="alert">{err}</p>}

      <section className="card" aria-labelledby="mem-h">
        <h2 id="mem-h">Members</h2>
        <div className="scroll"><table>
          <thead><tr><th>Name</th><th>Org ID</th><th>Role in project</th>{manage && <th />}</tr></thead>
          <tbody>
            {p.members.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td><td>{m.orgId}</td><td>{m.role}</td>
                {manage && <td><button className="secondary" onClick={() => run(() => api(`projects/${id}/members/${m.id}`, { method: 'DELETE' }))}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table></div>
        {manage && (
          <form className="row" style={{ marginTop: 12, alignItems: 'end' }} onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const userId = new FormData(e.currentTarget).get('userId');
            if (userId) void run(() => api(`projects/${id}/members`, { body: { userId, role } }));
          }}>
            <div><label htmlFor="m-user">Add person</label>
              <select id="m-user" name="userId" defaultValue=""><option value="" disabled>Choose…</option>{addable.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.orgId})</option>)}</select></div>
            <div><label htmlFor="m-role">As</label>
              <select id="m-role" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'lead')}><option value="member">Member</option><option value="lead">Lead</option></select></div>
            <button type="submit">Add</button>
          </form>
        )}
      </section>

      {manage && (
        <section className="card" aria-labelledby="set-h">
          <h2 id="set-h">Settings</h2>
          <form key={p.name + p.description} onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(() => api(`projects/${id}`, { method: 'PATCH', body: { name: f.get('name'), description: f.get('description') } }));
          }}>
            <label htmlFor="s-name">Name</label><input id="s-name" name="name" defaultValue={p.name} required maxLength={100} style={{ width: '100%' }} />
            <label htmlFor="s-desc">Description</label><textarea id="s-desc" name="description" defaultValue={p.description} maxLength={2000} />
            <p className="row"><button type="submit">Save</button>
              <button type="button" className="secondary" onClick={() => run(() => api(`projects/${id}`, { method: 'PATCH', body: { archived: !p.archivedAt } }))}>{p.archivedAt ? 'Unarchive project' : 'Archive project'}</button></p>
            <p className="muted" style={{ fontSize: 13 }}>Archived projects are read-only and hidden from task lists.</p>
          </form>
        </section>
      )}
    </>
  );
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  return <Shell>{() => <Body id={id} />}</Shell>;
}
