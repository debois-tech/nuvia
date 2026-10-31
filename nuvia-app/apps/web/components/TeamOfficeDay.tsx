'use client';
import { fmtTime, useApi } from '@/lib/api';

interface Row { userId: string; orgId: string; name: string; checkInAt: string | null; checkOutAt: string | null }

/** Who in the office has checked in today. Leads see their team, HR and executives see everyone. */
export function TeamOfficeDay() {
  const { data, error } = useApi<Row[]>('attendance/office/day', 60_000);
  return (
    <section className="card" aria-labelledby="team-h">
      <h2 id="team-h">Office check-ins today</h2>
      {error && <p className="err">{error}</p>}
      <div className="scroll">
        <table>
          <thead><tr><th>Person</th><th>In</th><th>Out</th></tr></thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.userId}>
                <td>{r.name} <span className="muted">{r.orgId}</span></td>
                <td>{r.checkInAt ? fmtTime(r.checkInAt) : <span className="pill open">Not in yet</span>}</td>
                <td>{fmtTime(r.checkOutAt)}</td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={3} className="muted">No office-mode staff in your view.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
