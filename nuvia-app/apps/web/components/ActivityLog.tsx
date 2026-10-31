'use client';
import { useState } from 'react';
import { api, fmtDuration, fmtDateTime, useApi } from '@/lib/api';
import { Activity, flagLabel } from '@/lib/types';
import { PeriodTable, Timeline } from './Timeline';

const todayStr = () => new Intl.DateTimeFormat('en-CA').format(new Date());

/** The employee's own log for one day: what was recorded, and anything that was flagged, with a way to explain it. */
export function ActivityLog() {
  const [date, setDate] = useState(todayStr());
  const { data, error, reload } = useApi<Activity>(`attendance/me/activity?date=${date}`, 60_000);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  async function explain(flagId: string) {
    setMsg('');
    try {
      await api(`attendance/me/flags/${flagId}/note`, { method: 'POST', body: { text: notes[flagId] } });
      setNotes({ ...notes, [flagId]: '' });
      setMsg('Your explanation was sent with the flag.');
      void reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <section className="card" aria-labelledby="log-h">
      <div className="row spread">
        <h2 id="log-h">Your activity log</h2>
        <div><label htmlFor="log-date" style={{ display: 'inline', marginRight: 8 }}>Day</label><input id="log-date" type="date" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      </div>
      <p className="muted">Only timing is recorded: when you were active, idle or away. No screenshots, keystrokes or file contents.</p>
      {error && <p className="err" role="alert">{error}</p>}
      {data && (
        <>
          <div className="totals">
            <div className="total"><b>{fmtDuration(data.totals.activeSeconds)}</b>Active</div>
            <div className="total"><b>{fmtDuration(data.totals.idleSeconds)}</b>Idle</div>
            <div className="total"><b>{fmtDuration(data.totals.absentSeconds)}</b>Marked absent</div>
            <div className="total"><b>{fmtDuration(data.totals.offlineSeconds)}</b>Agent offline</div>
          </div>
          {data.sessions.length === 0 && <p className="muted">Nothing recorded for this day.</p>}
          {data.sessions.map((s) => (
            <div key={s.id} style={{ marginBottom: 16 }}>
              <b>{fmtDateTime(s.startedAt)} {s.endedAt ? `to ${fmtDateTime(s.endedAt)}` : '(in progress)'}</b>
              <Timeline periods={s.periods} />
              <PeriodTable periods={s.periods} />
            </div>
          ))}
          {data.flags.length > 0 && (
            <>
              <h2>Flagged for review</h2>
              <p className="muted">A flag is a question for your manager, not a verdict. If there was a good reason (a call, reading, a meeting), add it here.</p>
              {data.flags.map((f) => (
                <div key={f.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
                  <div className="row spread">
                    <span>{flagLabel(f.kind)} <span className="muted">({fmtDateTime(f.createdAt)})</span></span>
                    <span className={`pill ${f.status}`}>{f.status === 'open' ? 'Waiting for review' : f.status}</span>
                  </div>
                  {f.employeeNote && <p><b>Your explanation:</b> {f.employeeNote}</p>}
                  {f.resolutionNote && <p><b>Reviewer:</b> {f.resolutionNote}</p>}
                  {f.status === 'open' && (
                    <>
                      <label htmlFor={`n-${f.id}`}>{f.employeeNote ? 'Update your explanation' : 'Add an explanation'}</label>
                      <textarea id={`n-${f.id}`} maxLength={1000} value={notes[f.id] ?? ''} onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })} />
                      <button className="secondary" disabled={!notes[f.id]?.trim()} onClick={() => explain(f.id)}>Send</button>
                    </>
                  )}
                </div>
              ))}
              {msg && <p role="status" className="muted">{msg}</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
