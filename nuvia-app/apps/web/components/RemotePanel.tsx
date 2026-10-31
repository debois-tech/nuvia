'use client';
import { api, fmtTime, useApi } from '@/lib/api';
import { Device, TodayRemote } from '@/lib/types';
import { ActivityLog } from './ActivityLog';

function Indicator({ t }: { t: TodayRemote }) {
  const s = t.session;
  if (!s) return <p className="status"><span className="dot" />Not tracking. Start work from the Nuvia desktop agent in your system tray.</p>;
  if (s.trackingActive) return <p className="status"><span className="dot on" />Tracking active <span className="muted">since {fmtTime(s.startedAt)}</span></p>;
  if (s.state === 'absent') return <p className="status"><span className="dot bad" />Marked away. Move the mouse or press a key to resume.</p>;
  return <p className="status"><span className="dot warn" />Agent not reporting. Last heard {fmtTime(s.lastHeartbeatAt)}. Check that it is running and online.</p>;
}

export function RemotePanel() {
  // Refreshes every 15s so the indicator tracks the agent, not a stale page.
  const today = useApi<TodayRemote>('attendance/me/today', 15_000);
  const devices = useApi<Device[]>('devices');

  async function revoke(id: string) {
    if (!confirm('Revoke this device? The agent on it stops working until you register it again.')) return;
    await api(`devices/${id}/revoke`, { method: 'POST', body: {} });
    void devices.reload();
  }

  return (
    <>
      <section className="card" aria-labelledby="remote-h">
        <h2 id="remote-h">Remote work tracking</h2>
        {today.error && <p className="err" role="alert">{today.error}</p>}
        {today.data && (
          <>
            <Indicator t={today.data} />
            <p className="muted">
              The desktop agent notes when you use the mouse or keyboard. After {today.data.idleMinutes} minutes of nothing it asks if you are there. If you don't answer, your manager is told so they can check, and it is not treated as a verdict.
            </p>
            {today.data.enrolledDevices === 0 && <p className="err">No computer is registered yet. Install the Nuvia desktop agent and sign in with your org ID.</p>}
          </>
        )}
      </section>

      <ActivityLog />

      <section className="card" aria-labelledby="dev-h">
        <h2 id="dev-h">Your registered computers</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Name</th><th>Registered</th><th>Last seen</th><th /></tr></thead>
            <tbody>
              {devices.data?.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{new Date(d.createdAt).toLocaleDateString()}</td>
                  <td>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}</td>
                  <td>{d.revokedAt ? <span className="pill low">Revoked</span> : <button className="secondary" onClick={() => revoke(d.id)}>Revoke</button>}</td>
                </tr>
              ))}
              {devices.data?.length === 0 && <tr><td colSpan={4} className="muted">None.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
