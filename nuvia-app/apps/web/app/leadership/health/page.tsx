'use client';
import { FormEvent, useEffect, useState } from 'react';
import { StatusBadge } from '@/components/charts/Cards';
import { HEALTH } from '@/components/charts/theme';
import { ExecOnly, LeadershipNav } from '@/components/leadership/Parts';
import { Shell } from '@/components/Shell';
import { api, fmtDateTime, useApi } from '@/lib/api';
import { Health, HealthRules } from '@/lib/types';

type Draft = Record<string, string>;
const FIELDS: { group: keyof HealthRules; key: string; label: string; hint: string }[] = [
  { group: 'revenue', key: 'onTrackMin', label: 'Revenue: on track from (% of target)', hint: 'Revenue as a share of target, this fiscal quarter so far' },
  { group: 'revenue', key: 'atRiskMin', label: 'Revenue: at risk from (% of target)', hint: 'Below this it is off track' },
  { group: 'margin', key: 'onTrackMin', label: 'Margin: on track from (%)', hint: '(Revenue minus cost) as a share of revenue' },
  { group: 'margin', key: 'atRiskMin', label: 'Margin: at risk from (%)', hint: 'Below this it is off track' },
  { group: 'runway', key: 'onTrackMinMonths', label: 'Cash runway: on track from (months)', hint: 'Cash divided by the recent monthly burn' },
  { group: 'runway', key: 'atRiskMinMonths', label: 'Cash runway: at risk from (months)', hint: 'Below this it is off track' },
  { group: 'milestones', key: 'onTrackMaxLatePct', label: 'Milestones: on track up to (% late)', hint: 'Share of milestones already due that are not done' },
  { group: 'milestones', key: 'atRiskMaxLatePct', label: 'Milestones: at risk up to (% late)', hint: 'Above this it is off track' },
  { group: 'milestones', key: 'warnDays', label: 'Flag a milestone this many days before it is due', hint: 'If its linked work is behind (next box)' },
  { group: 'milestones', key: 'warnProgressBelowPct', label: '…when linked work is less than this % done', hint: 'A milestone with no linked work is never flagged early' },
];

const toDraft = (r: HealthRules): Draft => Object.fromEntries(FIELDS.map((f) => [`${f.group}.${f.key}`, String((r[f.group] as Record<string, number>)[f.key])]));

function Rules() {
  const { data, error, reload } = useApi<Health>('leadership/health');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (data && !draft) setDraft(toDraft(data.rules)); }, [data, draft]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setErr(''); setMsg('');
    const body: Record<string, Record<string, number>> = {};
    for (const f of FIELDS) (body[f.group] ??= {})[f.key] = Number(draft[`${f.group}.${f.key}`]);
    try {
      await api('leadership/health/rules', { method: 'PUT', body });
      setMsg('Saved. The verdict and alerts now use these rules.');
      setDraft(null);
      await reload();
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  if (error) return <p className="err" role="alert">{error}</p>;
  if (!data || !draft) return <p className="muted">Loading…</p>;
  const h = HEALTH[data.status];
  return (
    <>
      {!data.rulesConfirmed ? (
        <div className="banner" role="note">These are <b>proposed defaults</b>. Nobody has confirmed them. Agree them as CEO, CTO and COO, then save.</div>
      ) : (
        <p className="muted">Last saved by {data.rulesConfirmed.by ?? 'someone'} on {fmtDateTime(data.rulesConfirmed.at)}. Every change is kept in the audit log.</p>
      )}
      <section className="card" aria-labelledby="now-h">
        <h2 id="now-h">Where the company stands under these rules</h2>
        <div className="verdict"><div className="big" style={{ color: h.text }}><span aria-hidden>{h.icon}</span> {h.label}</div><p style={{ flex: 1, minWidth: 240, margin: 0 }}>{data.reason}</p></div>
        <div className="scroll" style={{ marginTop: 12 }}><table>
          <thead><tr><th>Measure</th><th>Now</th><th>Status</th><th>Rule</th></tr></thead>
          <tbody>{data.measures.map((m) => <tr key={m.key}><td>{m.label}</td><td>{m.summary}</td><td><StatusBadge status={m.status} /></td><td className="muted">{m.rule}</td></tr>)}</tbody>
        </table></div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>The company verdict is the worst of the measures that have data. A measure with no data does not count for or against.</p>
      </section>
      <section className="card" aria-labelledby="ed-h">
        <h2 id="ed-h">Thresholds</h2>
        <form onSubmit={save}>
          <div className="formgrid fixlabel">
            {FIELDS.map((f) => {
              const id = `r-${f.group}-${f.key}`;
              return (
                <div key={id}>
                  <label htmlFor={id}>{f.label}</label>
                  <input id={id} type="number" step="any" required value={draft[`${f.group}.${f.key}`]} onChange={(e) => setDraft({ ...draft, [`${f.group}.${f.key}`]: e.target.value })} style={{ width: '100%' }} aria-describedby={`${id}-h`} />
                  <div id={`${id}-h`} className="muted" style={{ fontSize: 12 }}>{f.hint}</div>
                </div>
              );
            })}
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          {msg && <p className="ok" role="status">{msg}</p>}
          <p><button type="submit">Save thresholds</button></p>
        </form>
      </section>
    </>
  );
}

export default function HealthPage() {
  return (
    <Shell>
      {(me) => (
        <ExecOnly me={me}>
          <h1>Health rules</h1>
          <LeadershipNav />
          <Rules />
        </ExecOnly>
      )}
    </Shell>
  );
}
