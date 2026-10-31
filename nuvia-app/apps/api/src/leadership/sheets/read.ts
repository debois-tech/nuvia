import { parseCsv } from './csv';
import { Cell, MAX_COLS, MAX_ROWS, Sheet, SheetError } from './types';
import { readXlsx } from './xlsx';

export { SheetError } from './types';
export type { Cell, Sheet } from './types';

/** Reads an uploaded file by its content, not its name: a zip is .xlsx, anything else is read as CSV text. */
export function readWorkbook(buf: Buffer): Sheet[] {
  if (buf.length === 0) throw new SheetError('The file is empty.');
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0) {
    throw new SheetError('This is an old Excel (.xls) or password-protected file. In Excel use Save As and choose .xlsx or CSV, then upload that.');
  }
  if (buf.subarray(0, 4096).includes(0)) throw new SheetError('This does not look like a spreadsheet or CSV file.');
  let rows: Cell[][];
  try {
    rows = parseCsv(buf.toString('utf8'));
  } catch (err) {
    throw new SheetError((err as Error).message);
  }
  if (rows.length > MAX_ROWS) throw new SheetError(`The file has more than ${MAX_ROWS.toLocaleString('en-US')} rows.`);
  if (rows.some((r) => r.length > MAX_COLS)) throw new SheetError(`The file has more than ${MAX_COLS} columns.`);
  return [{ name: 'CSV', rows }];
}

const filled = (r: Cell[]) => r.filter((c) => c !== null && c !== '');

/** 1-based number of the row that looks like the header: the first with two or more cells where most are text. */
export function detectHeaderRow(rows: Cell[][]): number | null {
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const cells = filled(rows[i]);
    if (cells.length >= 2 && cells.filter((c) => typeof c === 'string').length * 2 >= cells.length) return i + 1;
  }
  return null;
}

export function hasData(sheet: Sheet): boolean {
  return detectHeaderRow(sheet.rows) !== null;
}
