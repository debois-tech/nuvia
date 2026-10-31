import type { Cell } from './types';

const DELIMITERS = [',', ';', '\t'] as const;

/** Picks the delimiter that splits the first non-empty line into the most fields (ignoring quoted text). */
function sniffDelimiter(text: string): string {
  const line = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF, a leading byte-order mark. Cells come back as trimmed strings or null. */
export function parseCsv(input: string): Cell[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delim = sniffDelimiter(text);
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;

  const endField = () => {
    const v = wasQuoted ? field : field.trim();
    row.push(v === '' ? null : v);
    field = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      quoted = true;
      wasQuoted = true;
      field = '';
    } else if (ch === delim) endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
  }
  if (quoted) throw new Error('A quoted value is never closed. Check the quotes in the file.');
  if (field !== '' || row.length) endRow();
  return rows.map((r) => r.map((c) => (typeof c === 'string' ? c.trim() || null : c)));
}
