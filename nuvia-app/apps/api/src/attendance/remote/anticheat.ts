import { createHash } from 'node:crypto';
import type { Step } from '@nuvia/shared';

/**
 * Heuristics for movement that looks scripted. They only produce flags for a person to review.
 * They cannot catch a hardware jiggler or a well-randomised script, and a determined person with
 * the device secret can forge heartbeats. They make casual cheating visible, nothing more.
 */

export interface PathFeatures {
  moveSamples: number;
  /** Largest side of the bounding box of the reconstructed path, in px. A 1px back-and-forth jiggle is ~1. */
  extent: number;
  /** Std-dev / mean of step length. Scripted constant-speed motion is near 0, human motion is well above 0.2. */
  stepLengthCv: number;
  /** Best repeat match of the (direction, length) sequence against itself at a lag of 2..120 steps. 1 = perfect loop. */
  periodicity: number;
  /** Hash of the whole window, to spot the same recorded path replayed every minute. */
  stepsHash: string | null;
}

export type Severity = 'low' | 'medium' | 'high';
export interface Signal {
  kind: string;
  severity: Severity;
  detail: Record<string, number | string>;
}

export const THRESHOLDS = {
  minSamples: 20,
  jiggleMaxExtent: 8,
  periodicMinSamples: 40,
  periodicity: 0.9,
  uniformMinSamples: 40,
  uniformCv: 0.05,
  identicalWindowsToFlag: 3,
};

const UNIT: [number, number][] = [
  [1, 0],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [Math.SQRT1_2, Math.SQRT1_2],
];

export function analyzePath(steps: Step[]): PathFeatures {
  const n = steps.length;
  if (n === 0) return { moveSamples: 0, extent: 0, stepLengthCv: 0, periodicity: 0, stepsHash: null };

  let x = 0, y = 0, minX = 0, maxX = 0, minY = 0, maxY = 0, sum = 0;
  for (const [d, len] of steps) {
    x += Math.round(UNIT[d][0] * len);
    y += Math.round(UNIT[d][1] * len);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    sum += len;
  }
  const mean = sum / n;
  const variance = steps.reduce((a, [, len]) => a + (len - mean) ** 2, 0) / n;

  const sym = steps.map(([d, len]) => d * 256 + len);
  let periodicity = 0;
  for (let lag = 2; lag <= Math.min(120, Math.floor(n / 2)); lag++) {
    let match = 0;
    for (let i = 0; i + lag < n; i++) if (sym[i] === sym[i + lag]) match++;
    periodicity = Math.max(periodicity, match / (n - lag));
  }

  return {
    moveSamples: n,
    extent: Math.max(maxX - minX, maxY - minY),
    stepLengthCv: mean > 0 ? Math.sqrt(variance) / mean : 0,
    periodicity,
    stepsHash: createHash('sha256').update(sym.join(',')).digest('hex').slice(0, 16),
  };
}

/** `recentHashes` are the hashes of this session's previous heartbeats, newest first. */
export function evaluateWindow(f: PathFeatures, recentHashes: (string | null)[], t = THRESHOLDS): Signal[] {
  const out: Signal[] = [];
  if (f.moveSamples >= t.minSamples && f.extent <= t.jiggleMaxExtent) {
    out.push({ kind: 'scripted_jiggle', severity: 'medium', detail: { moveSamples: f.moveSamples, extentPx: f.extent } });
  }
  if (f.moveSamples >= t.periodicMinSamples && f.periodicity >= t.periodicity) {
    out.push({ kind: 'scripted_repeating_path', severity: 'medium', detail: { moveSamples: f.moveSamples, periodicity: round(f.periodicity) } });
  }
  if (f.moveSamples >= t.uniformMinSamples && f.stepLengthCv <= t.uniformCv) {
    out.push({ kind: 'scripted_uniform_motion', severity: 'medium', detail: { moveSamples: f.moveSamples, stepLengthCv: round(f.stepLengthCv) } });
  }
  if (f.stepsHash && f.moveSamples >= t.minSamples) {
    const repeats = recentHashes.filter((h) => h === f.stepsHash).length + 1;
    if (repeats >= t.identicalWindowsToFlag) {
      out.push({ kind: 'scripted_identical_windows', severity: 'high', detail: { windows: repeats } });
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
