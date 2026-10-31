'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { isExecutive, Me } from '@/lib/types';

const TABS: [string, string][] = [
  ['/leadership', 'Overview'],
  ['/leadership/revenue', 'Revenue'],
  ['/leadership/goals', 'Goals and timeline'],
  ['/leadership/health', 'Health rules'],
  ['/leadership/import', 'Import sheet'],
];

export function LeadershipNav() {
  const path = usePathname();
  return (
    <nav className="subnav" aria-label="Leadership">
      {TABS.map(([href, label]) => {
        const on = href === '/leadership' ? path === href : path === href || path.startsWith(`${href}/`);
        return <Link key={href} href={href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{label}</Link>;
      })}
    </nav>
  );
}

/** The leadership pages are for executives. The server enforces it too; this just avoids showing an error wall. */
export function ExecOnly({ me, children }: { me: Me; children: ReactNode }) {
  if (!isExecutive(me.role)) {
    return (
      <>
        <div className="pagehead"><h1>Leadership</h1></div>
        <section className="card"><p>The leadership view is for the CEO, CTO and COO.</p></section>
      </>
    );
  }
  return <>{children}</>;
}
