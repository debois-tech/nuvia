'use client';
import { DragEvent, useRef, useState } from 'react';
import { ExecOnly } from '@/components/leadership/Parts';
import { PageHeader } from '@/components/ui';
import { Shell } from '@/components/Shell';
import { fmtDateTime, HttpError, uploadRaw, useApi } from '@/lib/api';
import { ImportPreview, ImportRecord, ImportResult } from '@/lib/types';

const TEMPLATE = 'Month,Department,Revenue,Target,Cost,Cash In,Cash Out,Closing Cash\n2026-04,Sales,1200000,1500000,800000,1100000,900000,\n2026-04,Operations,300000,300000,250000,,,5200000\n';
const letter = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

interface RowError { row: number; message: string }

function Importer() {
  const history = useApi<ImportRecord[]>('leadership/imports');
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState<number | undefined>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rowErrors, setRowErrors] = useState<{ list: RowError[]; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [over, setOver] = useState(false);

  const current = preview?.sheets.find((s) => s.name === sheet);

  async function load(f: File, opts: { sheet?: string; headerRow?: number } = {}) {
    setBusy(true); setErr(''); setRowErrors(null); setResult(null);
    try {
      const p = await uploadRaw<ImportPreview>('leadership/imports/preview', f, { sheet: opts.sheet, headerRow: opts.headerRow });
      const s = p.sheets.find((x) => x.name === p.selected) ?? p.sheets[0];
      setPreview(p); setSheet(s.name); setHeaderRow(s.headerRow);
      setMapping(Object.fromEntries(Object.entries(s.suggested).map(([k, v]) => [k, String(v)])));
    } catch (e) {
      setPreview(null); setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  function pick(f: File | undefined | null) {
    if (!f) return;
    setFile(f);
    void load(f);
  }
  function drop(e: DragEvent) { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }

  async function run() {
    if (!file || !current) return;
    setBusy(true); setErr(''); setRowErrors(null); setResult(null);
    const m = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
    try {
      setResult(await uploadRaw<ImportResult>('leadership/imports', file, { sheet, headerRow, mapping: JSON.stringify(m) }));
      setPreview(null); setFile(null); if (input.current) input.current.value = '';
      void history.reload();
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof HttpError && e.status === 422 && e.body?.errors) setRowErrors({ list: e.body.errors, total: e.body.totalErrors });
    } finally { setBusy(false); }
  }

  const template = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'nuvia-revenue-template.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <section className="card" aria-labelledby="up-h">
        <h2 id="up-h">Upload a sheet</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Excel (.xlsx) or CSV, one row per month and department. Money is plain numbers in one currency. Columns can be in any order: you choose which is which in the next step.
          Uploading the same month and department again replaces it. <button type="button" className="secondary" onClick={template}>Download a template</button>
        </p>
        <div className={`dropzone ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <p style={{ marginTop: 0 }}>Drop a file here, or</p>
          <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Choose a sheet" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        {busy && <p className="muted" role="status">Working…</p>}
        {err && <p className="err" role="alert">{err}</p>}
        {rowErrors && (
          <>
            <ul className="errlist" aria-label="Problems in the sheet">
              {rowErrors.list.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
            </ul>
            {rowErrors.total > rowErrors.list.length && <p className="muted">…and {rowErrors.total - rowErrors.list.length} more.</p>}
          </>
        )}
        {result && (
          <div role="status" style={{ marginTop: 12 }}>
            <p className="ok" style={{ marginBottom: 4 }}>✓ Imported {result.rows} rows ({result.periodFrom} to {result.periodTo}){result.replaced > 0 && `. ${result.replaced} replaced figures that were already there`}.</p>
            {result.warnings.map((w, i) => <p key={i} className="muted" style={{ margin: '2px 0' }}>Note: {w}</p>)}
          </div>
        )}
      </section>

      {preview && current && (
        <section className="card" aria-labelledby="map-h">
          <h2 id="map-h">Which column is which?</h2>
          <div className="row" style={{ gap: 16 }}>
            {preview.sheets.length > 1 && (
              <div>
                <label htmlFor="sheet">Sheet</label>
                <select id="sheet" value={sheet} onChange={(e) => file && void load(file, { sheet: e.target.value })}>{preview.sheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
              </div>
            )}
            <div>
              <label htmlFor="hrow">Header is on row</label>
              <input id="hrow" type="number" min={1} max={1000} value={headerRow ?? 1} style={{ width: 90 }} onChange={(e) => setHeaderRow(Number(e.target.value) || 1)} onBlur={() => file && headerRow !== current.headerRow && void load(file, { sheet, headerRow })} />
            </div>
            <div className="muted" style={{ alignSelf: 'end', paddingBottom: 8 }}>{current.rowCount} data rows</div>
          </div>
          <div className="mapgrid">
            {preview.fields.map((f) => (
              <div key={f.field}>
                <label htmlFor={`m-${f.field}`}>{f.label}{f.required && ' (required)'}</label>
                <select id={`m-${f.field}`} value={mapping[f.field] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.field]: e.target.value })}>
                  <option value="">{f.required ? 'Choose a column' : 'Not in this sheet'}</option>
                  {current.headers.map((h, i) => <option key={i} value={i}>{letter(i)}: {h || '(no heading)'}</option>)}
                </select>
              </div>
            ))}
          </div>
          <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>First rows of the sheet</h3>
          <div className="scroll">
            <table>
              <thead><tr>{current.headers.map((h, i) => <th key={i}>{letter(i)}: {h}</th>)}</tr></thead>
              <tbody>{current.sample.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c ?? ''}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>If any row has a problem, nothing is imported and you'll see which rows to fix. Rows marked Total are skipped.</p>
          <p><button type="button" onClick={run} disabled={busy || mapping.month === undefined || mapping.month === ''}>Import</button></p>
        </section>
      )}

      <section className="card" aria-labelledby="hist-h">
        <h2 id="hist-h">Earlier uploads</h2>
        <div className="scroll"><table>
          <thead><tr><th>When</th><th>File</th><th>Months</th><th>Rows</th><th>By</th></tr></thead>
          <tbody>
            {history.data?.map((i) => <tr key={i.id}><td>{fmtDateTime(i.uploadedAt)}</td><td>{i.fileName}{i.sheetName && i.sheetName !== 'CSV' ? ` · ${i.sheetName}` : ''}</td><td>{i.periodFrom.slice(0, 7)} to {i.periodTo.slice(0, 7)}</td><td>{i.rowCount}</td><td>{i.uploadedBy}</td></tr>)}
            {history.data?.length === 0 && <tr><td colSpan={5} className="muted">Nothing uploaded yet.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}

export default function ImportPage() {
  return (
    <Shell>
      {(me) => (
        <ExecOnly me={me}>
          <PageHeader title="Import sheet" />
          <Importer />
        </ExecOnly>
      )}
    </Shell>
  );
}
