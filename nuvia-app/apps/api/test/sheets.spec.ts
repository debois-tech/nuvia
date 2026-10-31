import { strToU8, zipSync } from 'fflate';
import { parseCsv } from '../src/leadership/sheets/csv';
import { extractRecords, parseAmount, parseMonth, suggestMapping } from '../src/leadership/sheets/mapping';
import { detectHeaderRow, readWorkbook, SheetError } from '../src/leadership/sheets/read';

describe('csv', () => {
  it('handles quotes, commas inside quotes, doubled quotes, CRLF and a byte-order mark', () => {
    const rows = parseCsv('﻿Month,Note,Revenue\r\n2026-04,"Big, loud ""deal""","1,20,000"\r\n2026-05,,500\r\n');
    expect(rows).toEqual([
      ['Month', 'Note', 'Revenue'],
      ['2026-04', 'Big, loud "deal"', '1,20,000'],
      ['2026-05', null, '500'],
    ]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b;c\n1;2;3')[1]).toEqual(['1', '2', '3']);
    expect(parseCsv('a\tb\tc\n1\t2\t3')[1]).toEqual(['1', '2', '3']);
  });

  it('refuses an unclosed quote', () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(/never closed/);
  });
});

describe('month and amount parsing', () => {
  it.each([
    ['2026-03', '2026-03-01'], ['2026-3', '2026-03-01'], ['2026-03-15', '2026-03-01'], ['2026-03-15T00:00:00Z', '2026-03-01'],
    ['03/2026', '2026-03-01'], ['Mar 2026', '2026-03-01'], ['March-26', '2026-03-01'], ["Sept'26", '2026-09-01'], ['2026 Mar', '2026-03-01'],
    ['25/03/2026', '2026-03-01'], ['03/25/2026', '2026-03-01'], [202603, '2026-03-01'],
  ])('reads %p', (input, out) => {
    expect(parseMonth(input as any)).toEqual({ value: out });
  });

  it.each(['', 'Q1 2026', '13/2026', '05/06/2026', 'Marchh 2026', '1999-01', 'hello', 5])('refuses %p', (input) => {
    expect('error' in parseMonth((input === '' ? null : input) as any)).toBe(true);
  });

  it.each([
    [1234.5, 1234.5], ['1,234.50', 1234.5], ['12,34,567', 1234567], ['₹ 1,20,000', 120000], ['Rs. 500', 500], ['$99', 99], ['(500)', -500], ['-70', -70],
    ['-', 0], ['', null], ['N/A', null], ['0', 0],
  ])('reads amount %p', (input, out) => {
    expect(parseAmount(input as any)).toEqual({ value: out });
  });

  it.each(['1.2 Cr', '5L', '12%', 'abc', '1,2,3', '1e5', '12 34', '99999999999999'])('refuses amount %p', (input) => {
    expect('error' in parseAmount(input)).toBe(true);
  });
});

describe('mapping and records', () => {
  it('suggests columns from exact header names only', () => {
    expect(suggestMapping(['Month', 'Dept', 'Actual Revenue', 'Revenue Target', 'Total Expenses', 'Cash Balance', 'Notes'])).toEqual({
      month: 0, department: 1, revenue: 2, target: 3, cost: 4, closingCash: 5,
    });
    expect(suggestMapping(['Foo', 'Bar'])).toEqual({});
  });

  const map = { month: 0, department: 1, revenue: 2, target: 3 };

  it('builds one record per month and department, with blank departments as Unassigned', () => {
    const r = extractRecords([['2026-04', 'Sales', '100', '120'], ['2026-04', null, '5', null], [null, null, null, null]], map, 2);
    expect(r.errors).toEqual([]);
    expect(r.records).toEqual([
      { period: '2026-04-01', department: 'Sales', revenue: 100, target: 120, cost: null, cashIn: null, cashOut: null, closingCash: null },
      { period: '2026-04-01', department: 'Unassigned', revenue: 5, target: null, cost: null, cashIn: null, cashOut: null, closingCash: null },
    ]);
    expect(r.warnings.join(' ')).toMatch(/blank department/);
  });

  it('skips total rows so nothing is counted twice, and says so', () => {
    const r = extractRecords([['2026-04', 'Sales', '100', '120'], ['2026-04', 'Total', '100', '120'], ['Grand total', null, '100', '120']], map, 2);
    expect(r.records).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Skipped 2 total rows/);
  });

  it('reports every bad row with its sheet row number and rejects duplicates and negatives', () => {
    const r = extractRecords(
      [['2026-04', 'Sales', '100', '120'], ['nope', 'Sales', '1', '1'], ['2026-05', 'Sales', 'abc', '1'], ['2026-04', 'sales', '1', '1'], ['2026-06', 'Ops', '-5', '1']],
      map,
      2,
    );
    expect(r.errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
    expect(r.errors[0].message).toMatch(/not a month/);
    expect(r.errors[1].message).toMatch(/Revenue \(actual\): .*not a plain number/);
    expect(r.errors[2].message).toMatch(/already on row 2/);
    expect(r.errors[3].message).toMatch(/must not be negative/);
  });
});

/** Builds a tiny but real .xlsx in memory. */
function xlsx(opts: { sheetXml?: string; date1904?: boolean; extra?: Record<string, Uint8Array> } = {}) {
  const sheet =
    opts.sheetXml ??
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Revenue</t></is></c></row>
      <row r="2"><c r="A2" s="1"><v>46113</v></c><c r="B2" t="s"><v>2</v></c><c r="C2"><v>1500.5</v></c></row>
      <row r="4"><c r="A4" t="str"><f>A2</f><v>x &amp; y</v></c><c r="C4" t="e"><v>#DIV/0!</v></c></row>
    </sheetData></worksheet>`;
  return Buffer.from(
    zipSync({
      'xl/workbook.xml': strToU8(`<workbook><workbookPr${opts.date1904 ? ' date1904="1"' : ''}/><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(`<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>`),
      'xl/sharedStrings.xml': strToU8(`<sst><si><t>Month</t></si><si><t>Department</t></si><si><r><t>Sa</t></r><r><t>les</t></r><rPh><t>ignored</t></rPh></si></sst>`),
      'xl/styles.xml': strToU8(`<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="mmm\\-yy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>`),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
      'xl/worksheets/sheet2.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Second</t></is></c></row></sheetData></worksheet>'),
      ...(opts.extra ?? {}),
    }),
  );
}

describe('xlsx reader', () => {
  it('reads strings, numbers, rich text, inline strings, formulas results, errors and date-formatted cells', () => {
    const sheets = readWorkbook(xlsx());
    expect(sheets.map((s) => s.name)).toEqual(['Data', 'Other']);
    const rows = sheets[0].rows;
    expect(rows[0]).toEqual(['Month', 'Department', 'Revenue']);
    expect(rows[1]).toEqual(['2026-04-01', 'Sales', 1500.5]); // 46113 with a custom "mmm-yy" format
    expect(rows[2]).toEqual([]); // skipped row 3
    expect(rows[3]).toEqual(['x & y', null, '#DIV/0!']);
    expect(sheets[1].rows[0]).toEqual(['Second']);
    expect(detectHeaderRow(rows)).toBe(1);
  });

  it('honours the 1904 date system', () => {
    const rows = readWorkbook(xlsx({ date1904: true }))[0].rows;
    expect(rows[1][0]).toBe('2030-04-02');
  });

  it('does not treat plain numbers as dates', () => {
    const rows = readWorkbook(xlsx({ sheetXml: '<worksheet><sheetData><row r="1"><c r="A1" s="0"><v>46113</v></c></row></sheetData></worksheet>' }))[0].rows;
    expect(rows[0][0]).toBe(46113);
  });

  it('rejects damaged files, old .xls, binary junk and empty files with plain messages', () => {
    expect(() => readWorkbook(Buffer.from('PK\x03\x04 not really a zip'))).toThrow(/could not be opened/);
    expect(() => readWorkbook(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toThrow(/old Excel/);
    expect(() => readWorkbook(Buffer.from([1, 2, 0, 3]))).toThrow(/does not look like/);
    expect(() => readWorkbook(Buffer.alloc(0))).toThrow(SheetError);
    expect(() => readWorkbook(Buffer.from(zipSync({ 'hello.txt': strToU8('hi') })))).toThrow(/does not look like an Excel/);
  });

  it('refuses a workbook that unpacks to something huge, without inflating it', () => {
    const big = new Uint8Array(41 * 1024 * 1024); // compresses to almost nothing
    expect(() => readWorkbook(xlsx({ sheetXml: '<worksheet/>', extra: { 'xl/worksheets/sheet3.xml': big } }))).toThrow(/too large once unpacked/);
  });

  it('is not fooled by a zip that lies about its size: it reads only what the header declares', () => {
    const real = xlsx({ sheetXml: `<worksheet><sheetData>${' '.repeat(3 * 1024 * 1024)}</sheetData></worksheet>` });
    for (let i = 0; i < real.length - 30; i++) {
      if (real.readUInt32LE(i) === 0x04034b50 && real.readUInt32LE(i + 22) > 1e6) real.writeUInt32LE(100, i + 22);
      if (real.readUInt32LE(i) === 0x02014b50 && real.readUInt32LE(i + 24) > 1e6) real.writeUInt32LE(100, i + 24);
    }
    const sheets = readWorkbook(real); // no crash, no giant allocation; the truncated sheet simply has no rows
    expect(sheets[0].rows.filter((r) => r.length)).toEqual([]);
  });

  it('rejects a sheet with too many rows', () => {
    const xml = `<worksheet><sheetData><row r="20001"><c r="A20001"><v>1</v></c></row></sheetData></worksheet>`;
    expect(() => readWorkbook(xlsx({ sheetXml: xml }))).toThrow(/more than 20,000 rows/);
  });

  it('reads a CSV by content', () => {
    const [s] = readWorkbook(Buffer.from('Month,Revenue\n2026-04,100\n'));
    expect(s.rows).toEqual([['Month', 'Revenue'], ['2026-04', '100']]);
  });
});
