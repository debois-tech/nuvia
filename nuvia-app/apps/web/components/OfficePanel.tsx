'use client';
import { useState } from 'react';
import { api, fmtTime, useApi } from '@/lib/api';
import { OfficeRecord, TodayOffice } from '@/lib/types';

export function OfficePanel() {
  const today = useApi<TodayOffice>('attendance/me/today');
  const history = useApi<OfficeRecord[]>('attendance/office/history');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rec = today.data?.record ?? null;

  async function act(path: 'check-in' | 'check-out') {
    setBusy(true);
    setError('');
    try {
      await api(`attendance/office/${path}`, { method: 'POST', body: {} });
      await Promise.all([today.reload(), history.reload()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card" aria-labelledby="office-h">
        <h2 id="office-h">Today in the office</h2>
        {today.loading && <p className="muted">Loading…</p>}
        {today.data && (
          <>
            <p className="status">
              {!rec && <>Not checked in</>}
              {rec && !rec.checkOutAt && <><span className="dot on" />Checked in at {fmtTime(rec.checkInAt)}</>}
              {rec?.checkOutAt && <>Checked in {fmtTime(rec.checkInAt)}, out {fmtTime(rec.checkOutAt)}</>}
            </p>
            <div className="row">
              <button onClick={() => act('check-in')} disabled={busy || Boolean(rec)}>Check in</button>
              <button className="secondary" onClick={() => act('check-out')} disabled={busy || !rec || Boolean(rec.checkOutAt)}>Check out</button>
            </div>
            {today.data.networkRestricted && <p className="muted">Check-in works only from the office network.</p>}
          </>
        )}
        {error && <p className="err" role="alert">{error}</p>}
        {today.error && <p className="err" role="alert">{today.error}</p>}
      </section>

      <section className="card" aria-labelledby="hist-h">
        <h2 id="hist-h">Your recent days</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Date</th><th>In</th><th>Out</th></tr></thead>
            <tbody>
              {history.data?.slice(0, 30).map((r) => (
                <tr key={r.id}><td>{r.workDate}</td><td>{fmtTime(r.checkInAt)}</td><td>{fmtTime(r.checkOutAt)}</td></tr>
              ))}
              {history.data?.length === 0 && <tr><td colSpan={3} className="muted">No records yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
