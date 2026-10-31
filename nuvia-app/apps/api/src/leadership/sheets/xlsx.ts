import { strFromU8, unzipSync } from 'fflate';
import { Cell, MAX_COLS, MAX_ROWS, Sheet, SheetError } from './types';

// A minimal .xlsx reader: it reads the zip, the sheet list, shared strings, date formats and cell values.
// Formulas are not evaluated; the value Excel last saved is used. Nothing in the file is executed.

const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

const NEEDED = /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/[^/]+\.xml)$/;

function entities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = entities(m[2] ?? m[3] ?? '');
  return out;
}

/** Text of a <si> or <is> element: every <t> run joined, without phonetic hints. */
function richText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += entities(m[1] ?? '');
  return out;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormat(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(stripped);
}

function dateStyles(styles: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!styles) return out;
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.numFmtId && a.formatCode) custom.set(Number(a.numFmtId), a.formatCode);
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
    const id = Number(attrs(m[0]).numFmtId ?? 0);
    const code = custom.get(id);
    if (code !== undefined ? isDateFormat(code) : BUILTIN_DATE_FORMATS.has(id)) out.add(i);
    i++;
  }
  return out;
}

function serialToIso(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.floor(serial) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function parseSheet(xml: string, shared: string[], dates: Set<number>, date1904: boolean): Cell[][] {
  const rows: Cell[][] = [];
  let rowNo = -1;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1]);
    rowNo = ra.r ? Number(ra.r) - 1 : rowNo + 1;
    if (!Number.isInteger(rowNo) || rowNo < 0) throw new SheetError('The workbook has an invalid row number.');
    if (rowNo >= MAX_ROWS) throw new SheetError(`The sheet has more than ${MAX_ROWS.toLocaleString('en-US')} rows. Split it or remove empty rows.`);
    const body = rm[2];
    if (!body) continue;
    const cells: Cell[] = [];
    let col = -1;
    for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(cm[1]);
      col = ca.r ? colIndex(ca.r) : col + 1;
      if (col < 0 || col >= MAX_COLS) {
        if (col >= MAX_COLS) throw new SheetError(`The sheet has more than ${MAX_COLS} columns.`);
        continue;
      }
      const inner = cm[2] ?? '';
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: Cell = null;
      switch (ca.t) {
        case 's': {
          const s = v === undefined ? undefined : shared[Number(v)];
          value = s === undefined || s === '' ? null : s;
          break;
        }
        case 'inlineStr':
          value = richText(inner) || null;
          break;
        case 'str':
          value = v === undefined ? null : entities(v) || null;
          break;
        case 'b':
          value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : null;
          break;
        case 'e':
          value = v === undefined ? null : entities(v);
          break;
        case 'd':
          value = v === undefined ? null : entities(v).slice(0, 10);
          break;
        default: {
          if (v === undefined || v === '') break;
          const n = Number(v);
          if (!Number.isFinite(n)) break;
          const iso = dates.has(Number(ca.s ?? -1)) ? serialToIso(n, date1904) : null;
          value = iso ?? n;
        }
      }
      cells[col] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
    rows[rowNo] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
  return rows;
}

export function readXlsx(buf: Buffer): Sheet[] {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf), {
      filter: (f) => {
        if (!NEEDED.test(f.name)) return false;
        total += f.originalSize;
        if (f.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) throw new SheetError('The workbook is too large once unpacked.');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof SheetError) throw err;
    throw new SheetError('The file could not be opened as an Excel workbook. It may be damaged or password-protected.');
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);
  const wb = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new SheetError('This does not look like an Excel (.xlsx) workbook.');

  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) targets.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`);
  }
  const date1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*"(1|true)"/i.test(wb);
  const sst = text('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(richText(m[1] ?? ''));
  const dates = dateStyles(text('xl/styles.xml'));

  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const path = a['r:id'] ? targets.get(a['r:id']) : undefined;
    const xml = path ? text(path) : undefined;
    if (!a.name || xml === undefined) continue;
    sheets.push({ name: a.name, rows: parseSheet(xml, shared, dates, date1904) });
  }
  if (!sheets.length) throw new SheetError('The workbook has no readable sheets.');
  return sheets;
}
