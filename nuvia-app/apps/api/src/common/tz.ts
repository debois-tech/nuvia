/** 'YYYY-MM-DD' of an instant in the given IANA timezone. */
export function workDateOf(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function formatTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
