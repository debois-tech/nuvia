// Chart colours. The categorical order is the validated default palette (see the dataviz skill): the first six
// slots pass the lightness, chroma and colour-blind separation checks on a light surface. Three of them are below
// 3:1 contrast on white, so every chart here also has a legend and a table view.
// Phase 6 (design pass) can swap these values for the reference design's palette; nothing else needs to change.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'] as const;
export const OTHER = '#c3c2b7';
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781' } as const;
export const GRID = '#e1e0d9';
export const AXIS = '#c3c2b7';
export const SURFACE = '#ffffff';
export const BLUE = SERIES[0];
/** Targets and other reference lines: recessive, not a series colour. */
export const REFERENCE = INK.muted;

// Status colours are reserved for status. They always come with an icon and a word.
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const;
export const HEALTH = {
  on_track: { color: STATUS.good, text: '#006300', icon: '✓', label: 'On track' },
  at_risk: { color: STATUS.warning, text: '#8a5a00', icon: '▲', label: 'At risk' },
  off_track: { color: STATUS.critical, text: '#a82b2b', icon: '✕', label: 'Off track' },
  unknown: { color: INK.muted, text: INK.secondary, icon: '–', label: 'No data yet' },
  no_data: { color: INK.muted, text: INK.secondary, icon: '–', label: 'No data' },
} as const;

export function money(n: number | null | undefined, currency: string, compact = false): string {
  if (n === null || n === undefined) return '–';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}
export const pctText = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n}%`);
