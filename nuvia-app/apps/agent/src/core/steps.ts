import { MAX_STEP_LENGTH, Step } from '@nuvia/shared';

/**
 * Turns a cursor move into a direction octant (0 = right, counter-clockwise: 1 = up-right, 2 = up ...)
 * and a distance in px. Absolute positions are never kept or sent.
 */
export function quantizeStep(dx: number, dy: number): Step | null {
  const len = Math.round(Math.hypot(dx, dy));
  if (len < 1) return null;
  // Screen y grows downwards, so flip it to get a conventional angle.
  const angle = Math.atan2(-dy, dx);
  const octant = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return [octant, Math.min(len, MAX_STEP_LENGTH)];
}
