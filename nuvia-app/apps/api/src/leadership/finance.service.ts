import { BadRequestException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/roles';
import { Clock } from '../common/clock';
import { DbService } from '../common/db.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AlertsService } from './alerts.service';
import { fiscalQuarterLabel, fiscalYearLabel, fiscalYearStart, monthLabel, MonthTotals, quarterStart } from './health';
import { HealthService } from './health.service';
import { FinanceQuery, ImportQuery, MappingSchema } from './schemas';
import { Cell, detectHeaderRow, hasData, readWorkbook, Sheet, SheetError } from './sheets/read';
import { extractRecords, FIELD_LABEL, FIELDS, Mapping, suggestMapping } from './sheets/mapping';

type ImportQ = z.output<typeof ImportQuery>;
type FinanceQ = z.output<typeof FinanceQuery>;

const MAX_ERRORS_SHOWN = 50;

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const sum = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) : null;
};

/** 'YYYY-MM' of a month `n` months after (or before) 'YYYY-MM-01'. */
function addMonths(period: string, n: number): string {
  const d = new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly health: HealthService,
    private readonly alerts: AlertsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private open(buf: Buffer): Sheet[] {
    try {
      return readWorkbook(buf);
    } catch (err) {
      if (err instanceof SheetError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private pick(sheets: Sheet[], name?: string): Sheet {
    const s = name ? sheets.find((x) => x.name === name) : sheets.find(hasData);
    if (!s) throw new BadRequestException(name ? `There is no sheet called "${name}" in this file` : 'No sheet in this file has a header row with data under it');
    return s;
  }

  /** Reads the file and reports what is in it, so the person can check the column mapping. Nothing is stored. */
  preview(buf: Buffer, q: ImportQ) {
    const sheets = this.open(buf);
    const selected = this.pick(sheets, q.sheet).name;
    return {
      selected,
      fields: FIELDS.map((f) => ({ field: f, label: FIELD_LABEL[f], required: f === 'month' })),
      sheets: sheets
        .filter((s) => s.name === selected || hasData(s))
        .map((s) => {
          const headerRow = (s.name === selected ? q.headerRow : undefined) ?? detectHeaderRow(s.rows) ?? 1;
          const header = s.rows[headerRow - 1] ?? [];
          const width = Math.max(header.length, 1);
          const headers = Array.from({ length: width }, (_, i) => (header[i] === null || header[i] === undefined ? '' : String(header[i])));
          return {
            name: s.name,
            headerRow,
            headers,
            rowCount: s.rows.slice(headerRow).filter((r) => r.some((c) => c !== null)).length,
            sample: s.rows.slice(headerRow, headerRow + 5).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null)),
            suggested: suggestMapping(header),
          };
        }),
    };
  }

  async import(user: AuthUser, buf: Buffer, q: ImportQ) {
    const sheet = this.pick(this.open(buf), q.sheet);
    let mapping: Mapping;
    try {
      mapping = MappingSchema.parse(JSON.parse(q.mapping ?? '{}'));
    } catch {
      throw new BadRequestException('The column mapping is not valid');
    }
    const used = Object.values(mapping);
    if (new Set(used).size !== used.length) throw new BadRequestException('Each column can be used for one thing only');
    if (mapping.month === undefined) throw new BadRequestException('Choose which column holds the month');
    if (FIELDS.every((f) => f === 'month' || f === 'department' || mapping[f] === undefined)) throw new BadRequestException('Choose at least one column with figures (revenue, target, cost or cash)');

    const headerRow = q.headerRow ?? detectHeaderRow(sheet.rows);
    if (!headerRow) throw new BadRequestException('Could not find a header row');
    const width = Math.max(...sheet.rows.slice(0, headerRow).map((r) => r.length), 0);
    if (used.some((i) => i >= Math.max(width, (sheet.rows[headerRow - 1] ?? []).length))) throw new BadRequestException('A chosen column is outside the sheet');

    const { records, errors, warnings } = extractRecords(sheet.rows.slice(headerRow) as Cell[][], mapping, headerRow + 1);
    if (errors.length) {
      throw new UnprocessableEntityException({
        message: `${errors.length} row${errors.length === 1 ? ' has' : 's have'} a problem, so nothing was imported. Fix the sheet and upload it again.`,
        errors: errors.slice(0, MAX_ERRORS_SHOWN),
        totalErrors: errors.length,
      });
    }
    if (!records.length) throw new BadRequestException('There are no data rows under the header');

    const periods = records.map((r) => r.period).sort();
    const sha = createHash('sha256').update(buf).digest('hex');
    const now = this.clock.now();
    const set = (f: keyof Mapping) => mapping[f] !== undefined;

    const result = await this.db.tx(async (tx) => {
      // The first spelling of a department wins, so "sales" and "Sales" are one department.
      const canon = new Map<string, string>();
      for (const r of (await tx.query('SELECT DISTINCT ON (lower(department)) department FROM finance_rows ORDER BY lower(department), period')).rows) canon.set(String(r.department).toLowerCase(), r.department);
      for (const rec of records) {
        const k = rec.department.toLowerCase();
        if (!canon.has(k)) canon.set(k, rec.department);
        rec.department = canon.get(k)!;
      }
      const replaced = (
        await tx.query(
          `SELECT count(*)::int AS n FROM finance_rows f JOIN unnest($1::date[], $2::text[]) AS t(p, d) ON f.period = t.p AND lower(f.department) = lower(t.d)`,
          [records.map((r) => r.period), records.map((r) => r.department)],
        )
      ).rows[0].n as number;
      const imp = (
        await tx.query(
          `INSERT INTO finance_imports (file_name, sheet_name, sha256, row_count, period_from, period_to, mapping, warnings, uploaded_by, uploaded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [q.name.slice(0, 200), sheet.name, sha, records.length, periods[0], periods[periods.length - 1], JSON.stringify(mapping), JSON.stringify(warnings), user.id, now],
        )
      ).rows[0].id as string;
      const col = (k: 'revenue' | 'target' | 'cost' | 'cashIn' | 'cashOut' | 'closingCash') => records.map((r) => r[k]);
      // Columns that are in the mapping replace what was stored (a blank cell clears it). Columns that are not stay as they were.
      await tx.query(
        `INSERT INTO finance_rows (period, department, revenue, target, cost, cash_in, cash_out, closing_cash, import_id)
         SELECT p, d, rv, tg, co, ci, cu, cc, $9::uuid
         FROM unnest($1::date[], $2::text[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[]) AS t(p, d, rv, tg, co, ci, cu, cc)
         ON CONFLICT (period, department) DO UPDATE SET
           revenue = CASE WHEN $10::boolean THEN EXCLUDED.revenue ELSE finance_rows.revenue END,
           target = CASE WHEN $11::boolean THEN EXCLUDED.target ELSE finance_rows.target END,
           cost = CASE WHEN $12::boolean THEN EXCLUDED.cost ELSE finance_rows.cost END,
           cash_in = CASE WHEN $13::boolean THEN EXCLUDED.cash_in ELSE finance_rows.cash_in END,
           cash_out = CASE WHEN $14::boolean THEN EXCLUDED.cash_out ELSE finance_rows.cash_out END,
           closing_cash = CASE WHEN $15::boolean THEN EXCLUDED.closing_cash ELSE finance_rows.closing_cash END,
           import_id = EXCLUDED.import_id`,
        [
          records.map((r) => r.period), records.map((r) => r.department), col('revenue'), col('target'), col('cost'), col('cashIn'), col('cashOut'), col('closingCash'), imp,
          set('revenue'), set('target'), set('cost'), set('cashIn'), set('cashOut'), set('closingCash'),
        ],
      );
      await this.audit.record(user.id, 'finance.import', { type: 'finance_import', id: imp }, { file: q.name, sheet: sheet.name, sha256: sha, rows: records.length, from: periods[0], to: periods[periods.length - 1], replaced }, tx);
      return { importId: imp, replaced };
    });
    await this.alerts.sync();
    return { ...result, rows: records.length, periodFrom: periods[0].slice(0, 7), periodTo: periods[periods.length - 1].slice(0, 7), warnings };
  }

  async imports() {
    const { rows } = await this.db.query(
      `SELECT i.id, i.file_name, i.sheet_name, i.row_count, i.period_from, i.period_to, i.warnings, i.uploaded_at, u.name AS uploaded_by
       FROM finance_imports i JOIN users u ON u.id = i.uploaded_by ORDER BY i.uploaded_at DESC LIMIT 30`,
    );
    return rows;
  }

  /** Everything the revenue dashboard draws, for one range of months (default: this fiscal year so far). */
  async dashboard(f: FinanceQ) {
    const start = this.cfg.fiscalYearStartMonth;
    const all = await this.health.companyMonths();
    const withRevenue = all.filter((m) => m.revenue !== null);
    const asOf = withRevenue.length ? withRevenue[withRevenue.length - 1].period : null;
    const base = {
      currency: this.cfg.currency,
      fiscalYearStartMonth: start,
      asOf: asOf?.slice(0, 7) ?? null,
      available: all.length ? { from: all[0].period.slice(0, 7), to: all[all.length - 1].period.slice(0, 7) } : null,
    };
    if (!all.length) return { ...base, range: null, months: [], quarters: [], departments: [], totals: null, fiscalYear: null };

    const last = all[all.length - 1].period;
    const toP = f.to ? `${f.to}-01` : asOf ?? last;
    const fromP = f.from ? `${f.from}-01` : `${fiscalYearStart(toP, start)}-${String(start).padStart(2, '0')}-01`;
    if (fromP > toP) throw new BadRequestException('"from" must not be after "to"');
    const inRange = all.filter((m) => m.period >= fromP && m.period <= toP);

    const months = inRange.map((m) => ({
      period: m.period.slice(0, 7),
      label: monthLabel(m.period),
      revenue: m.revenue,
      target: m.target,
      cost: m.cost,
      cashIn: m.cashIn,
      cashOut: m.cashOut,
      closingCash: m.closingCash,
      attainmentPct: m.revenue !== null && m.target ? pct(m.revenue, m.target) : null,
    }));

    const groups = new Map<string, MonthTotals[]>();
    for (const m of inRange) {
      const k = quarterStart(m.period, start);
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    const quarters = [...groups.entries()].map(([from, ms]) => {
      const pairs = ms.filter((m) => m.revenue !== null && m.target !== null);
      const t = sum(pairs.map((m) => m.target));
      return {
        label: fiscalQuarterLabel(from, start),
        from: from.slice(0, 7),
        to: addMonths(from, 2).slice(0, 7),
        months: ms.length,
        complete: ms.length === 3,
        revenue: sum(ms.map((m) => m.revenue)),
        target: sum(ms.map((m) => m.target)),
        cost: sum(ms.map((m) => m.cost)),
        attainmentPct: t ? pct(sum(pairs.map((m) => m.revenue)) ?? 0, t) : null,
      };
    });

    const deps = (
      await this.db.query(
        `SELECT department,
                sum(revenue)::float8 AS revenue, sum(cost)::float8 AS cost, sum(target)::float8 AS target,
                (sum(revenue) FILTER (WHERE revenue IS NOT NULL AND target IS NOT NULL))::float8 AS cmp_revenue,
                (sum(target) FILTER (WHERE revenue IS NOT NULL AND target IS NOT NULL))::float8 AS cmp_target
         FROM finance_rows WHERE period >= $1 AND period <= $2 GROUP BY department ORDER BY sum(revenue) DESC NULLS LAST, department`,
        [fromP, toP],
      )
    ).rows;
    const departments = deps.map((d) => ({
      department: d.department as string,
      revenue: d.revenue as number | null,
      cost: d.cost as number | null,
      target: d.target as number | null,
      attainmentPct: d.cmpTarget ? pct(d.cmpRevenue ?? 0, d.cmpTarget) : null,
    }));

    const pairs = inRange.filter((m) => m.revenue !== null && m.target !== null);
    const mp = inRange.filter((m) => m.revenue !== null && m.cost !== null);
    const rev = sum(inRange.map((m) => m.revenue));
    const totals = {
      revenue: rev,
      target: sum(inRange.map((m) => m.target)),
      attainmentPct: sum(pairs.map((m) => m.target)) ? pct(sum(pairs.map((m) => m.revenue)) ?? 0, sum(pairs.map((m) => m.target))!) : null,
      cost: sum(inRange.map((m) => m.cost)),
      marginPct: mp.length && sum(mp.map((m) => m.revenue)) ? pct((sum(mp.map((m) => m.revenue)) ?? 0) - (sum(mp.map((m) => m.cost)) ?? 0), sum(mp.map((m) => m.revenue))!) : null,
      cashIn: sum(inRange.map((m) => m.cashIn)),
      cashOut: sum(inRange.map((m) => m.cashOut)),
    };
    return {
      ...base,
      range: { from: fromP.slice(0, 7), to: toP.slice(0, 7) },
      fiscalYear: fiscalYearLabel(toP, start),
      months,
      quarters,
      departments,
      totals,
    };
  }
}
