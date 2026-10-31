import type { Cell } from './types';

export const FIELDS = ['month', 'department', 'revenue', 'target', 'cost', 'cashIn', 'cashOut', 'closingCash'] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, number>>;

export const FIELD_LABEL: Record<Field, string> = {
  month: 'Month',
  department: 'Department',
  revenue: 'Revenue (actual)',
  target: 'Revenue target',
  cost: 'Cost / expenses',
  cashIn: 'Cash in',
  cashOut: 'Cash out',
  closingCash: 'Closing cash balance',
};

const AMOUNT_FIELDS = ['revenue', 'target', 'cost', 'cashIn', 'cashOut', 'closingCash'] as const;
type AmountField = (typeof AMOUNT_FIELDS)[number];

const ALIASES: Record<Field, string[]> = {
  month: ['month', 'period', 'date', 'monthyear', 'reportingmonth', 'formonth'],
  department: ['department', 'dept', 'team', 'businessunit', 'bu', 'division', 'function'],
  revenue: ['revenue', 'actualrevenue', 'revenueactual', 'sales', 'turnover'],
  target: ['target', 'revenuetarget', 'targetrevenue', 'plan', 'revenueplan', 'salestarget', 'revenuebudget', 'budgetedrevenue'],
  cost: ['cost', 'costs', 'expenses', 'expense', 'totalcost', 'totalexpenses', 'opex', 'operatingcost', 'operatingexpenses', 'spend'],
  cashIn: ['cashin', 'cashinflow', 'inflow', 'inflows', 'receipts', 'collections', 'cashreceived'],
  cashOut: ['cashout', 'cashoutflow', 'outflow', 'outflows', 'payments', 'cashpaid', 'disbursements'],
  closingCash: ['closingcash', 'cashbalance', 'closingbalance', 'bankbalance', 'cashposition', 'endingcash'],
};

const norm = (s: Cell) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Guesses which column holds what, from exact header names only. The user confirms or fixes it. */
export function suggestMapping(headers: Cell[]): Mapping {
  const out: Mapping = {};
  const used = new Set<number>();
  for (const f of FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && ALIASES[f].includes(norm(h)));
    if (idx >= 0) {
      out[f] = idx;
      used.add(idx);
    }
  }
  return out;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** 1-12 for "Mar", "march" or "Sept"; 0 when the word is not a month. */
const monthByName = (word: string) => {
  const w = word.toLowerCase();
  return MONTH_NAMES.findIndex((n) => n === w || n.slice(0, 3) === w || (w === 'sept' && n === 'september')) + 1;
};

const ym = (y: number, m: number): string | null => (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}-01` : null);

/** Returns the first day of the month as 'YYYY-MM-01', or an error message. Ambiguous day/month dates are refused. */
export function parseMonth(cell: Cell): { value: string } | { error: string } {
  if (cell === null) return { error: 'The month is empty' };
  if (typeof cell === 'number') {
    const s = String(cell);
    const r = /^(\d{4})(\d{2})$/.exec(s);
    const v = r ? ym(Number(r[1]), Number(r[2])) : null;
    return v ? { value: v } : { error: `"${cell}" is not a month. Use YYYY-MM, like 2026-03` };
  }
  const t = cell.trim();
  let m: RegExpExecArray | null;
  let v: string | null = null;
  if ((m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[T ].*)?$/.exec(t))) v = ym(Number(m[1]), Number(m[2]));
  else if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(t))) v = ym(Number(m[2]), Number(m[1]));
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) v = ym(Number(m[3]), b);
    else if (b > 12 && a <= 12) v = ym(Number(m[3]), a);
    else return { error: `"${t}" could be day/month or month/day. Use YYYY-MM, like 2026-03` };
  } else if ((m = /^([A-Za-z]{3,9})[\s.,'’-]*(\d{2}|\d{4})$/.exec(t)) && monthByName(m[1])) {
    v = ym(m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]), monthByName(m[1]));
  } else if ((m = /^(\d{4})[\s.,-]*([A-Za-z]{3,9})$/.exec(t)) && monthByName(m[2])) v = ym(Number(m[1]), monthByName(m[2]));
  return v ? { value: v } : { error: `"${t}" is not a month. Use YYYY-MM, like 2026-03` };
}

/** Plain numbers only, in the sheet's own currency. Accepts commas, a currency symbol, and (500) for negatives. */
export function parseAmount(cell: Cell): { value: number | null } | { error: string } {
  if (cell === null) return { value: null };
  if (typeof cell === 'number') return Number.isFinite(cell) && Math.abs(cell) < 1e13 ? { value: Math.round(cell * 100) / 100 } : { error: 'The number is too large' };
  let t = cell.trim();
  if (t === '') return { value: null };
  if (/^(n\/?a|null|none|tbd)$/i.test(t)) return { value: null };
  if (/^[-–—]+$/.test(t)) return { value: 0 };
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/^(rs\.?|inr|usd|eur|gbp|[₹$€£])\s*/i, '').trim();
  if (t.startsWith('-')) {
    neg = !neg;
    t = t.slice(1);
  }
  // Commas group digits (1,234,567 or the Indian 12,34,567); anything else is not a plain number.
  if (!/^(\d{1,3}(,\d{2,3})*|\d+)(\.\d+)?$/.test(t)) {
    return { error: /(cr|crore|lakh|lac|[lkm])$/i.test(t) ? `"${cell}" uses a unit (lakh, crore, K, M). Write the full number` : `"${cell}" is not a plain number` };
  }
  const n = Number(t.replace(/,/g, ''));
  if (!Number.isFinite(n) || n >= 1e13) return { error: 'The number is too large' };
  return { value: Math.round((neg ? -n : n) * 100) / 100 };
}

const TOTAL_RE = /^(grand\s+|sub\s*)?total$|^all(\s+departments?)?$|^company(\s+total)?$/i;

export interface FinanceRecord {
  period: string;
  department: string;
  revenue: number | null;
  target: number | null;
  cost: number | null;
  cashIn: number | null;
  cashOut: number | null;
  closingCash: number | null;
}

export interface RowIssue {
  row: number;
  message: string;
}

export interface Extracted {
  records: FinanceRecord[];
  errors: RowIssue[];
  warnings: string[];
}

const NON_NEGATIVE: AmountField[] = ['revenue', 'target', 'cost', 'cashIn', 'cashOut'];

/**
 * Turns sheet rows into one record per month and department. `rows` are the rows after the header;
 * `firstRowNumber` is the sheet row number of rows[0], used in messages. Nothing is written here.
 */
export function extractRecords(rows: Cell[][], mapping: Mapping, firstRowNumber: number): Extracted {
  const errors: RowIssue[] = [];
  const warnings: string[] = [];
  const byKey = new Map<string, { rec: FinanceRecord; row: number }>();
  let skippedTotals = 0;
  const at = (r: Cell[], f: Field): Cell => (mapping[f] === undefined ? null : r[mapping[f]!] ?? null);

  rows.forEach((r, i) => {
    const rowNo = firstRowNumber + i;
    if (!r.some((c) => c !== null && c !== '')) return;
    const monthCell = at(r, 'month');
    const deptCell = at(r, 'department');
    if ((typeof monthCell === 'string' && TOTAL_RE.test(monthCell.trim())) || (typeof deptCell === 'string' && TOTAL_RE.test(deptCell.trim()))) {
      skippedTotals++;
      return;
    }
    const month = parseMonth(monthCell);
    if ('error' in month) {
      errors.push({ row: rowNo, message: month.error });
      return;
    }
    const department = deptCell === null ? 'Unassigned' : String(deptCell).replace(/\s+/g, ' ').trim().slice(0, 80) || 'Unassigned';
    const rec: FinanceRecord = { period: month.value, department, revenue: null, target: null, cost: null, cashIn: null, cashOut: null, closingCash: null };
    let bad = false;
    for (const f of AMOUNT_FIELDS) {
      if (mapping[f] === undefined) continue;
      const a = parseAmount(at(r, f));
      if ('error' in a) {
        errors.push({ row: rowNo, message: `${FIELD_LABEL[f]}: ${a.error}` });
        bad = true;
      } else if (a.value !== null && a.value < 0 && NON_NEGATIVE.includes(f)) {
        errors.push({ row: rowNo, message: `${FIELD_LABEL[f]} must not be negative` });
        bad = true;
      } else rec[f] = a.value;
    }
    if (bad) return;
    const key = `${rec.period}|${department.toLowerCase()}`;
    const prev = byKey.get(key);
    if (prev) {
      errors.push({ row: rowNo, message: `${department} for ${rec.period.slice(0, 7)} is already on row ${prev.row}` });
      return;
    }
    byKey.set(key, { rec, row: rowNo });
  });

  const records = [...byKey.values()].map((v) => v.rec);
  if (skippedTotals) warnings.push(`Skipped ${skippedTotals} total row${skippedTotals === 1 ? '' : 's'} so figures are not counted twice.`);
  const mixed = new Set<string>();
  for (const p of new Set(records.map((r) => r.period))) {
    const inP = records.filter((r) => r.period === p);
    if (inP.some((r) => r.department === 'Unassigned') && inP.some((r) => r.department !== 'Unassigned')) mixed.add(p.slice(0, 7));
  }
  if (mixed.size) {
    warnings.push(`${[...mixed].sort().join(', ')} ha${mixed.size === 1 ? 's' : 've'} rows with a blank department next to named departments. If the blank rows are company totals, they are being added on top of the departments.`);
  }
  return { records, errors, warnings };
}
