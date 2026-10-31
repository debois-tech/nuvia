'use client';
import Link from 'next/link';
import { fmtDate } from '@/lib/api';
import { Priority, PRIORITY_LABEL, STATUS_LABEL, TaskRow, TaskStatus } from '@/lib/types';

export const PriorityPill = ({ p }: { p: Priority }) => <span className={`pill pri-${p}`}>{PRIORITY_LABEL[p]}</span>;
export const StatusPill = ({ s }: { s: TaskStatus }) => <span className={`pill st-${s}`}>{STATUS_LABEL[s]}</span>;

export function Due({ date, overdue }: { date: string | null; overdue: boolean }) {
  if (!date) return <span className="muted">No due date</span>;
  return <span className={overdue ? 'err' : ''} style={{ margin: 0 }}>{overdue ? 'Overdue · ' : 'Due '}{fmtDate(date)}</span>;
}

export const ref = (t: { projectKey: string; number: number }) => `${t.projectKey}-${t.number}`;

/** A task on the board. Moving it is done with the select (keyboard friendly) or by dragging. */
export function TaskCard({ t, canMove, onMove, busy }: { t: TaskRow; canMove: boolean; onMove: (status: TaskStatus) => void; busy: boolean }) {
  return (
    <article
      className={`tcard ${canMove ? 'movable' : ''}`}
      draggable={canMove && !busy}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
    >
      <div className="row spread" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>{ref(t)}{t.parentNumber ? ` · sub-task of ${t.projectKey}-${t.parentNumber}` : ''}</span>
        <PriorityPill p={t.priority} />
      </div>
      <Link href={`/tasks/${t.id}`} className="ttitle">{t.title}</Link>
      <div style={{ fontSize: 13 }}><Due date={t.dueDate} overdue={t.overdue} /></div>
      <div className="row spread" style={{ gap: 6, fontSize: 13 }}>
        <span className={t.mine ? '' : 'muted'}>{t.assigneeName ? (t.mine ? 'You' : t.assigneeName) : 'Unassigned'}</span>
        <span className="muted">
          {t.subtaskCount > 0 && <>☑ {t.subtasksDone}/{t.subtaskCount} </>}
          {t.commentCount > 0 && <>💬 {t.commentCount} </>}
          {t.attachmentCount > 0 && <>📎 {t.attachmentCount}</>}
        </span>
      </div>
      {canMove && (
        <select aria-label={`Status of ${ref(t)}`} value={t.status} disabled={busy} onChange={(e) => onMove(e.target.value as TaskStatus)}>
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      )}
    </article>
  );
}
