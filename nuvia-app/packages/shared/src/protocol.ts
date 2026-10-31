/** Wire protocol between the desktop agent and the API. Timing and counts only, never content. */

/** One cursor movement between two polls: direction octant (0-7) and distance in px (capped). */
export type Step = [dir: number, len: number];

export const HEARTBEAT_INTERVAL_SECONDS = 60;
export const MAX_STEPS_PER_HEARTBEAT = 900;
export const MAX_STEP_LENGTH = 255;

export interface HeartbeatBody {
  sessionId: string;
  /** Strictly increasing per device. The server rejects anything <= the last seen value. */
  seq: number;
  /** Seconds the window covers (normally 60). */
  windowSeconds: number;
  /** Seconds within the window in which any input was seen (from the OS idle timer). */
  activeSeconds: number;
  /** Input events with no cursor movement, e.g. keyboard. Count only, never which keys. */
  otherInputEvents: number;
  /** Cursor movement as quantised steps. No coordinates are sent. */
  steps: Step[];
}

export type PromptKind = 'idle' | 'challenge';

export interface PromptInfo {
  id: string;
  kind: PromptKind;
  deadlineAt: string;
  /** Only for `challenge` prompts: the code the person has to type back. */
  code?: string;
}

export type SessionState = 'active' | 'prompted' | 'absent' | 'offline';

export interface HeartbeatResponse {
  state: SessionState;
  prompt: PromptInfo | null;
  serverTime: string;
}

export interface PromptResponseBody {
  /** Required for `challenge` prompts. */
  answer?: string;
  /** Strictly increasing per device, shared with heartbeats. */
  seq: number;
}

export interface SessionStartBody {
  seq: number;
}
export interface SessionStopBody {
  sessionId: string;
  seq: number;
}
