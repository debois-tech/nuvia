'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime, useApi } from '@/lib/api';
import { isExecutive, isReviewer, Me, Notification, Role, TaskRow } from '@/lib/types';
import { BellIcon, LogoMark, SearchIcon } from './Icons';
import { useDismiss } from './ui';

const ROLE_LABEL: Record<Role, string> = { employee: 'Employee', team_lead: 'Team lead', hr_admin: 'HR / admin', executive: 'CEO / CTO / COO' };

function Bell() {
  const { data, reload } = useApi<{ unread: number; items: Notification[] }>('notifications', 30_000);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  async function readAll() {
    await api('notifications/read-all', { method: 'POST', body: {} });
    void reload();
  }
  return (
    <div className="bell" ref={ref}>
      <button type="button" className="iconbtn" aria-expanded={open} aria-haspopup="dialog" aria-label={`Notifications, ${data?.unread ?? 0} unread`} onClick={() => setOpen(!open)}>
        <BellIcon />
        {data && data.unread > 0 && <span className="badge" aria-hidden>{data.unread}</span>}
      </button>
      {open && (
        <div className="pop" role="dialog" aria-label="Notifications">
          <div className="row spread" style={{ padding: 8 }}>
            <b style={{ fontWeight: 500 }}>Notifications</b>
            <button type="button" className="secondary" onClick={readAll} disabled={!data?.unread}>Mark all read</button>
          </div>
          <ul>
            {data?.items.length === 0 && <li className="muted">Nothing yet.</li>}
            {data?.items.map((n) => (
              <li key={n.id} className={n.readAt ? '' : 'unread'}>
                {n.taskId ? <Link href={`/tasks/${n.taskId}`} onClick={close}>{n.message}</Link>
                  : n.flagId ? <Link href={`/attendance/review?flag=${n.flagId}`} onClick={close}>{n.message}</Link>
                  : n.link && /^\/(?!\/)/.test(n.link) ? <Link href={n.link} onClick={close}>{n.message}</Link> : n.message}
                <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{fmtDateTime(n.createdAt)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Quick jump: pages you can open, and tasks matching what you type. */
function Search({ me, pages }: { me: Me; pages: [string, string][] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const close = useCallback(() => { setOpen(false); setQ(''); }, []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  useEffect(() => {
    if (q.trim().length < 2) { setTasks([]); return; }
    const t = setTimeout(() => { api<TaskRow[]>(`tasks?${new URLSearchParams({ q: q.trim(), limit: '6' })}`).then(setTasks).catch(() => setTasks([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const hits = pages.filter(([, l]) => l.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="bell" ref={ref}>
      <button type="button" className="iconbtn" aria-expanded={open} aria-label="Search" onClick={() => setOpen(!open)}><SearchIcon /></button>
      {open && (
        <div className="pop" role="dialog" aria-label="Search" data-user={me.id}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a page or a task (WEB-12 or words)" aria-label="Search" style={{ width: '100%' }} />
          <ul style={{ marginTop: 6 }}>
            {hits.map(([href, label]) => <li key={href}><Link href={href} onClick={close}>{label}</Link> <span className="muted" style={{ fontSize: 12 }}>page</span></li>)}
            {tasks.map((t) => <li key={t.id}><Link href={`/tasks/${t.id}`} onClick={close}>{t.projectKey}-{t.number}: {t.title}</Link></li>)}
            {hits.length === 0 && tasks.length === 0 && <li className="muted">{q.trim().length < 2 ? 'Type to search.' : 'No matches.'}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function Avatar({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  const initials = me.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return (
    <div className="avatarbox" ref={ref}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${me.name}`} onClick={() => setOpen(!open)}><span>{initials}</span></button>
      {open && (
        <div className="menu" role="menu">
          <div style={{ padding: '8px 12px 6px' }}><b style={{ fontWeight: 500 }}>{me.name}</b><div className="muted" style={{ fontSize: 13 }}>{ROLE_LABEL[me.role]} · {me.orgId}</div></div>
          <hr />
          <button type="button" className="item" role="menuitem" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }}>Sign out</button>
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

  const tabs: [string, string, boolean][] = [];
  if (isExecutive(me.role)) tabs.push(['/leadership', 'Home', false], ['/leadership/revenue', 'Revenue', true], ['/leadership/goals', 'Goals', true]);
  tabs.push(['/tasks', 'Tasks', true], ['/projects', 'Projects', true], ['/attendance', 'Attendance', false]);
  if (isReviewer(me.role)) tabs.push(['/attendance/review', 'Review', false]);
  const on = (href: string, prefix: boolean) => path === href || (prefix && path.startsWith(`${href}/`));
  // Health rules and Import belong to the Revenue / Goals area, so they keep that tab lit.
  const extra = path.startsWith('/leadership/health') || path.startsWith('/leadership/import') ? '/leadership/revenue' : null;

  return (
    <>
      <header className="top">
        <div className="in">
          <Link href="/" className="brand" aria-label="Nuvia home"><span className="mark"><LogoMark /></span>nuvia</Link>
          <nav aria-label="Main">
            {tabs.map(([href, label, prefix]) => {
              const active = on(href, prefix) || extra === href;
              return <Link key={href} href={href} className={active ? 'on' : ''} aria-current={active ? 'page' : undefined}>{label}</Link>;
            })}
          </nav>
          <div className="tools">
            <Search me={me} pages={tabs.map(([h, l]) => [h, l])} />
            <Bell />
            <Avatar me={me} />
          </div>
        </div>
      </header>
      <main className="page">{children(me)}</main>
    </>
  );
}
