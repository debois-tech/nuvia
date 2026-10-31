import { MAX_STEPS_PER_HEARTBEAT, Step } from '@nuvia/shared';
import { quantizeStep } from './steps';

export interface SamplerInputs {
  /** Cursor position anywhere on the desktop. */
  readCursor(): { x: number; y: number };
  /** Seconds since the last keyboard or mouse input, system wide (Electron: powerMonitor.getSystemIdleTime). */
  readIdleSeconds(): number;
  /** Wall-clock milliseconds. */
  now(): number;
}

export interface WindowSummary {
  windowSeconds: number;
  activeSeconds: number;
  otherInputEvents: number;
  steps: Step[];
}

/**
 * Collects one heartbeat window of activity. It looks at timing and counts only: how far the cursor
 * moved, and whether the OS idle timer was reset without the cursor moving (keyboard, in practice).
 * It never sees which keys were pressed or what is on screen.
 */
export class ActivitySampler {
  private prev: { x: number; y: number } | null = null;
  private lastIdle = Infinity;
  private steps: Step[] = [];
  private activeSecondsSeen = new Set<number>();
  private otherInput = 0;
  private windowStart: number;

  constructor(private readonly io: SamplerInputs, private readonly pollMs = 200) {
    this.windowStart = io.now();
  }

  poll(): void {
    const pos = this.io.readCursor();
    const idle = this.io.readIdleSeconds();
    const t = this.io.now();
    const moved = this.prev !== null && (pos.x !== this.prev.x || pos.y !== this.prev.y);

    if (moved && this.steps.length < MAX_STEPS_PER_HEARTBEAT) {
      const step = quantizeStep(pos.x - this.prev!.x, pos.y - this.prev!.y);
      if (step) this.steps.push(step);
    }
    // The idle timer dropping means some input arrived since the last poll.
    const inputSincePoll = idle < this.lastIdle;
    if (inputSincePoll && !moved && this.lastIdle !== Infinity) this.otherInput++;
    // Any input within the last poll interval counts that wall-clock second as active.
    if (moved || idle * 1000 < this.pollMs * 1.5) this.activeSecondsSeen.add(Math.floor(t / 1000));

    this.prev = pos;
    this.lastIdle = idle;
  }

  /** Returns the window collected so far and starts a new one. */
  flush(): WindowSummary {
    const t = this.io.now();
    const windowSeconds = Math.min(300, Math.max(1, Math.round((t - this.windowStart) / 1000)));
    const out: WindowSummary = {
      windowSeconds,
      activeSeconds: Math.min(this.activeSecondsSeen.size, windowSeconds),
      otherInputEvents: this.otherInput,
      steps: this.steps,
    };
    this.steps = [];
    this.activeSecondsSeen = new Set();
    this.otherInput = 0;
    this.windowStart = t;
    return out;
  }
}
