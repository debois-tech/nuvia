'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, fmtDateTime, useApi } from '@/lib/api';
import { isReviewer, Me, Notification } from '@/lib/types';

function Bell() {
  const { data, reload } = useApi<{ unread: number; items: Notification[] }>('notifications', 30_000);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  async function readAll() {
    await api('notifications/read-all', { method: 'POST', body: {} });
    void reload();
  }
  return (
    <div className="bell">
      <button className="secondary" aria-expanded={open} aria-label={`Notifications, ${data?.unread ?? 0} unread`} onClick={() => setOpen(!open)}>
        Alerts{data && data.unread > 0 && <span className="badge">{data.unread}</span>}
      </button>
      {open && (
        <div className="pop" role="dialog" aria-label="Notifications">
          <div className="row spread" style={{ padding: 8 }}>
            <b>Notifications</b>
            <button className="secondary" onClick={readAll} disabled={!data?.unread}>Mark all read</button>
          </div>
          <ul>
            {data?.items.length === 0 && <li className="muted">Nothing yet.</li>}
            {data?.items.map((n) => (
              <li key={n.id} className={n.readAt ? '' : 'unread'}>
                {n.taskId ? <Link href={`/tasks/${n.taskId}`} onClick={() => setOpen(false)}>{n.message}</Link>
                  : n.flagId ? <Link href={`/attendance/review?flag=${n.flagId}`} onClick={() => setOpen(false)}>{n.message}</Link> : n.message}
                <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{fmtDateTime(n.createdAt)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: (me: Me) => React.ReactNode }) {
  const { data: me, error } = useApi<Me>('auth/me');
  const path = usePathname();
  if (error) return <main className="page"><p className="err">{error}</p></main>;
  if (!me) return <main className="page muted">Loading…</main>;
  const link = (href: string, label: string, prefix = false) => {
    const on = path === href || (prefix && path.startsWith(`${href}/`));
    return <Link href={href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{label}</Link>;
  };
  return (
    <>
      <header className="top">
        <div className="in">
          <b>Nuvia</b>
          <nav aria-label="Main">
            {link('/tasks', 'Tasks', true)}
            {link('/projects', 'Projects', true)}
            {link('/attendance', 'Attendance')}
            {isReviewer(me.role) && link('/attendance/review', 'Review')}
          </nav>
          <span className="muted" style={{ fontSize: 13 }}>{me.name}</span>
          <Bell />
          <button className="secondary" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }}>Sign out</button>
        </div>
      </header>
      <main className="page">{children(me)}</main>
    </>
  );
}
