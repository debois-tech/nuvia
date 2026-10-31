/** A spreadsheet cell: text, a number, or empty. Date cells are turned into 'YYYY-MM-DD' text when the file is read. */
export type Cell = string | number | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
}

/** A problem with the file itself (wrong type, damaged, too large). The message is shown to the user as is. */
export class SheetError extends Error {}

export const MAX_ROWS = 20_000;
export const MAX_COLS = 100;
