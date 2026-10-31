'use client';
import Link from 'next/link';
import { MeterTile, StatusBadge } from '@/components/charts/Cards';
import { HEALTH } from '@/components/charts/theme';
import { ExecOnly, LeadershipNav } from '@/components/leadership/Parts';
import { Shell } from '@/components/Shell';
import { fmtDate, fmtDateTime, useApi } from '@/lib/api';
import { Measure, Overview } from '@/lib/types';

const SCALE: Record<Measure['key'], { min: number; max: number }> = {
  revenue: { min: 0, max: 120 },
  margin: { min: -20, max: 50 },
  runway: { min: 0, max: 24 },
  milestones: { min: 0, max: 50 },
};

function meterText(m: Measure): string {
  if (m.status === 'no_data') return 'No data';
  if (m.value === null) return m.key === 'runway' ? 'Not burning cash' : '–';
  if (m.key === 'runway') return `${m.value} mo`;
    return `${m.value}%`;
}

function Home() {
  const { data, error, loading } = useApi<Overview>('leadership/overview', 60_000);
  if (error) return <p className="err" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { health, alerts, goals, latestImport } = data;
  const h = HEALTH[health.status];
  return (
    <>
      {!health.rulesConfirmed && (
        <div className="banner" role="note">
          The thresholds behind this verdict are <b>proposed defaults</b>. The CEO, CTO and COO have not confirmed them yet. <Link href="/leadership/health">Review the rules</Link>
        </div>
      )}
      <section className="card" aria-labelledby="v-h" style={{ opacity: loading ? 0.6 : 1 }}>
        <div className="verdict">
          <div>
            <h2 id="v-h" className="muted" style={{ fontWeight: 400 }}>Company health</h2>
            <div className="big" style={{ color: h.text }}><span aria-hidden>{h.icon}</span> {h.label}</div>
          </div>
          <p style={{ flex: 1, minWidth: 240, margin: 0 }}>{health.reason}</p>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          {health.asOf ? <>Figures up to {fmtDate(health.asOf)} {health.window && <>· revenue and margin cover {health.window.label} so far</>}.</> : 'No sheet has been uploaded yet.'}
          {latestImport && <> Last upload: {latestImport.fileName} by {latestImport.uploadedBy}, {fmtDateTime(latestImport.uploadedAt)}.</>}
        </p>
      </section>

      <section className="card" aria-labelledby="al-h">
        <div className="row spread"><h2 id="al-h">Needs attention {alerts.length > 0 && <span className="muted">({alerts.length})</span>}</h2></div>
        {alerts.length === 0 && <p className="ok" style={{ margin: 0 }}>✓ Nothing is off track right now.</p>}
        {alerts.map((a) => (
          <div key={a.key} className={`alert ${a.severity}`}>
            <span className="ic" aria-hidden>{a.severity === 'critical' ? '✕' : '▲'}</span>
            <div style={{ flex: 1 }}>
              <div><b style={{ fontWeight: 600 }}>{a.title}</b> <span className="muted" style={{ fontSize: 12 }}>{a.severity === 'critical' ? 'Off track' : 'At risk'} since {fmtDate(a.raisedAt.slice(0, 10))}</span></div>
              <div className="muted" style={{ fontSize: 14 }}>{a.detail}</div>
            </div>
            <Link href={a.link}>Open</Link>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="m-h">
        <h2 id="m-h">The four measures</h2>
        <div className="meters">
          {health.measures.map((m) => (
            <MeterTile key={m.key} label={m.label} status={m.status} value={m.value} text={meterText(m)} min={SCALE[m.key].min} max={SCALE[m.key].max} caption={m.summary} rule={m.rule} />
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="g-h">
        <div className="row spread"><h2 id="g-h">Goals</h2><Link href="/leadership/goals">Timeline and goals</Link></div>
        <div className="row" style={{ gap: 24 }}>
          <div><b style={{ fontSize: 24, fontWeight: 500 }}>{goals.active}</b> <span className="muted">active</span></div>
          <div className="row" style={{ gap: 8 }}>
            <StatusBadge status="on_track" /> {goals.onTrack}
            <StatusBadge status="at_risk" /> {goals.atRisk}
            <StatusBadge status="off_track" /> {goals.offTrack}
          </div>
          <div className="muted">{goals.done} done</div>
        </div>
      </section>
    </>
  );
}

export default function LeadershipHome() {
  return (
    <Shell>
      {(me) => (
        <ExecOnly me={me}>
          <h1>Leadership</h1>
          <LeadershipNav />
          <Home />
        </ExecOnly>
      )}
    </Shell>
  );
}
