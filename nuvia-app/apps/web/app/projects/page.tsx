'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Shell } from '@/components/Shell';
import { api, useApi } from '@/lib/api';
import { canManageWork, ProjectSummary } from '@/lib/types';

export default function ProjectsPage() {
  const [archived, setArchived] = useState(false);
  const { data, error, reload } = useApi<ProjectSummary[]>(`projects${archived ? '?archived=1' : ''}`);
  const [err, setErr] = useState('');
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setErr('');
    try {
      await api('projects', { body: { key: f.get('key'), name: f.get('name'), description: f.get('description') || '' } });
      form.reset();
      await reload();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <Shell>
      {(me) => (
        <>
          <h1>Projects</h1>
          <section className="card" aria-labelledby="pl-h">
            <div className="row spread">
              <h2 id="pl-h">{me.role === 'hr_admin' || me.role === 'executive' ? 'All projects' : 'Your projects'}</h2>
              <label style={{ margin: 0, color: 'inherit' }}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>
            </div>
            {error && <p className="err" role="alert">{error}</p>}
            <div className="scroll"><table>
              <thead><tr><th>Key</th><th>Name</th><th>Open</th><th>Done</th><th>Your role</th></tr></thead>
              <tbody>
                {data?.map((p) => (
                  <tr key={p.id}>
                    <td>{p.key}</td>
                    <td><Link href={`/projects/${p.id}`}>{p.name}</Link>{p.archivedAt && <span className="muted"> · archived</span>}</td>
                    <td><Link href={`/tasks?project=${p.id}`}>{p.openTasks}</Link></td><td>{p.doneTasks}</td>
                    <td>{p.memberRole ?? <span className="muted">Viewer</span>}</td>
                  </tr>
                ))}
                {data?.length === 0 && <tr><td colSpan={5} className="muted">No projects yet.</td></tr>}
              </tbody>
            </table></div>
          </section>
          {canManageWork(me.role) && (
            <section className="card" aria-labelledby="np-h">
              <h2 id="np-h">New project</h2>
              <form onSubmit={create}>
                <div className="formgrid">
                  <div><label htmlFor="p-key">Key (e.g. WEB)</label><input id="p-key" name="key" required pattern="[A-Za-z][A-Za-z0-9]{1,7}" maxLength={8} style={{ width: '100%', textTransform: 'uppercase' }} /></div>
                  <div><label htmlFor="p-name">Name</label><input id="p-name" name="name" required maxLength={100} style={{ width: '100%' }} /></div>
                  <div className="wide"><label htmlFor="p-desc">Description (optional)</label><textarea id="p-desc" name="description" maxLength={2000} /></div>
                </div>
                {err && <p className="err" role="alert">{err}</p>}
                <p><button type="submit">Create project</button></p>
              </form>
            </section>
          )}
        </>
      )}
    </Shell>
  );
}
