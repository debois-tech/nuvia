'use client';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { PeriodTable, Timeline } from '@/components/Timeline';
import { Shell } from '@/components/Shell';
import { api, fmtDateTime, fmtDuration, fmtTime, useApi } from '@/lib/api';
import { canResolve, flagLabel, isReviewer, Me, ReviewDetail, ReviewRow } from '@/lib/types';

function Detail({ id, me, onDone }: { id: string; me: Me; onDone: () => void }) {
  const { data, error, reload } = useApi<ReviewDetail>(`attendance/review/flags/${id}`);
  const [decision, setDecision] = useState<'excused' | 'dismissed' | 'confirmed'>('excused');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  async function resolve(e: FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await api(`attendance/review/flags/${id}/resolve`, { method: 'POST', body: { decision, note } });
      setNote('');
      await reload();
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  if (error) return <p className="err" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { flag, periods, prompts, heartbeatSummary: hb } = data;
  return (
    <section className="card" aria-labelledby="detail-h" aria-live="polite">
      <h2 id="detail-h">{flag.name} <span className="muted">{flag.orgId}</span>: {flagLabel(flag.kind)}</h2>
      <p>
        <span className={`pill ${flag.severity}`}>{flag.severity}</span>{' '}
        <span className={`pill ${flag.status}`}>{flag.status}</span>{' '}
        <span className="muted">raised {fmtDateTime(flag.createdAt)}</span>
      </p>
      {flag.kind.startsWith('scripted_') && <p className="muted">These checks look for movement patterns typical of a mouse-jiggler or macro{Array.isArray(flag.detail.patterns) ? ` (matched: ${(flag.detail.patterns as string[]).join(', ').replace(/_/g, ' ')})` : ''}. They can be wrong, and they miss hardware jigglers. Treat this as a reason to look, not as proof.</p>}
      {flag.employeeNote && <p><b>{flag.name}'s explanation:</b> {flag.employeeNote}</p>}

      <h2>Session timeline</h2>
      <Timeline periods={periods} />
      <PeriodTable periods={periods} />
      {hb && <p className="muted">{hb.heartbeats} heartbeats, {fmtDuration(hb.activeSeconds)} of reported input, {hb.otherInputEvents} keyboard-type events. Only counts are kept; no keys, screenshots or window titles.</p>}

      {prompts.length > 0 && (
        <>
          <h2>Prompts shown</h2>
          <div className="scroll"><table>
            <thead><tr><th>Type</th><th>Shown</th><th>Result</th></tr></thead>
            <tbody>{prompts.map((p) => <tr key={p.id}><td>{p.kind === 'idle' ? 'Idle check' : 'Random presence check'}</td><td>{fmtTime(p.createdAt)}</td><td>{p.status}{p.attempts ? ` (${p.attempts} wrong)` : ''}</td></tr>)}</tbody>
          </table></div>
        </>
      )}

      {flag.status !== 'open' ? (
        <p><b>Reviewed{flag.resolvedByName ? ` by ${flag.resolvedByName}` : ''}:</b> {flag.status}. {flag.resolutionNote}</p>
      ) : canResolve(me.role) ? (
        <form onSubmit={resolve}>
          <h2>Your decision</h2>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="muted">Outcome</legend>
            {([['excused', 'Excused: there was a good reason'], ['dismissed', 'Dismiss: false alarm'], ['confirmed', 'Confirmed: follow up with the person']] as const).map(([v, label]) => (
              <label key={v} style={{ display: 'block', color: 'inherit' }}><input type="radio" name="decision" checked={decision === v} onChange={() => setDecision(v)} /> {label}</label>
            ))}
          </fieldset>
          <label htmlFor="note">Note (required, kept with the record)</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} required />
          {err && <p className="err" role="alert">{err}</p>}
          <p><button type="submit" disabled={!note.trim()}>Save decision</button></p>
        </form>
      ) : (
        <p className="muted">Your role can view flags but not decide them.</p>
      )}
    </section>
  );
}

function ReviewInner({ me }: { me: Me }) {
  const params = useSearchParams();
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [selected, setSelected] = useState<string | null>(params.get('flag'));
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(severity ? { severity } : {}) }).toString();
  const { data, error, reload } = useApi<ReviewRow[]>(`attendance/review/flags${qs ? `?${qs}` : ''}`, 30_000);
  useEffect(() => { const f = params.get('flag'); if (f) setSelected(f); }, [params]);

  return (
    <>
      <h1>Flagged periods</h1>
      <p className="muted">Flags are questions for a person to look at. Nothing here is applied automatically. {me.role === 'team_lead' ? 'You see your team.' : 'You see everyone.'}</p>
      <section className="card" aria-labelledby="list-h">
        <div className="row spread">
          <h2 id="list-h">Flags</h2>
          <div className="row">
            <label htmlFor="f-status" style={{ margin: 0 }}>Status</label>
            <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open</option><option value="">All</option><option value="excused">Excused</option><option value="dismissed">Dismissed</option><option value="confirmed">Confirmed</option>
            </select>
            <label htmlFor="f-sev" style={{ margin: 0 }}>Severity</label>
            <select id="f-sev" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </div>
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="scroll">
          <table>
            <thead><tr><th>Person</th><th>What</th><th>When</th><th>Severity</th><th>Status</th></tr></thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id} className={`click ${selected === r.id ? 'sel' : ''}`} onClick={() => setSelected(r.id)}>
                  <td>{r.name} <span className="muted">{r.orgId}</span></td>
                  <td>
                    <button className="secondary" style={{ border: 0, padding: 0, textAlign: 'left', background: 'none' }} onClick={() => setSelected(r.id)}>{flagLabel(r.kind)}</button>
                    {r.employeeNote && <div className="muted" style={{ fontSize: 13 }}>Explanation added</div>}
                  </td>
                  <td>{r.periodStartedAt ? `${fmtTime(r.periodStartedAt)}–${r.periodEndedAt ? fmtTime(r.periodEndedAt) : 'now'}` : fmtDateTime(r.createdAt)}</td>
                  <td><span className={`pill ${r.severity}`}>{r.severity}</span></td>
                  <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                </tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={5} className="muted">No flags match.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {selected && <Detail key={selected} id={selected} me={me} onDone={reload} />}
    </>
  );
}

export default function ReviewPage() {
  return (
    <Shell>
      {(me) => (isReviewer(me.role) ? <Suspense fallback={null}><ReviewInner me={me} /></Suspense> : <p className="err">This page is for team leads, HR and leadership.</p>)}
    </Shell>
  );
}
