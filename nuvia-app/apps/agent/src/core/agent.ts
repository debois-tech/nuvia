import type { PromptInfo, SessionState } from '@nuvia/shared';
import { HEARTBEAT_INTERVAL_SECONDS } from '@nuvia/shared';
import { AgentApi, ApiError } from './api';
import { ActivitySampler } from './sampler';

export type AgentStatus =
  | { kind: 'stopped' }
  | { kind: 'tracking' }
  | { kind: 'away'; message: string }
  | { kind: 'reconnecting' }
  | { kind: 'rejected'; message: string };

export interface AgentUi {
  setStatus(status: AgentStatus): void;
  showPrompt(prompt: PromptInfo): void;
  hidePrompt(): void;
}

/**
 * Runs the work session: samples input, sends a signed heartbeat every minute, shows the on-screen
 * prompt the server asks for, and reports whether tracking is live. No decisions about idleness or
 * absence are made here. The server decides, so a modified agent can't hide them.
 */
export class WorkTracker {
  private sessionId: string | null = null;
  private pollTimer?: NodeJS.Timeout;
  private beatTimer?: NodeJS.Timeout;
  private shownPromptId: string | null = null;
  private beating = false;

  constructor(
    private readonly api: AgentApi,
    private readonly sampler: ActivitySampler,
    private readonly ui: AgentUi,
    private readonly pollMs = 200,
    private readonly heartbeatMs = HEARTBEAT_INTERVAL_SECONDS * 1000,
  ) {}

  get working() {
    return this.sessionId !== null;
  }

  async startWork(): Promise<void> {
    if (this.working) return;
    const s = await this.api.startSession();
    this.sessionId = s.sessionId;
    this.sampler.flush();
    this.ui.setStatus({ kind: 'tracking' });
    this.pollTimer = setInterval(() => this.sampler.poll(), this.pollMs);
    this.beatTimer = setInterval(() => void this.beat(), this.heartbeatMs);
  }

  async stopWork(): Promise<void> {
    const id = this.sessionId;
    this.clearTimers();
    this.sessionId = null;
    this.dismissPrompt();
    this.ui.setStatus({ kind: 'stopped' });
    if (id) await this.api.stopSession(id).catch(() => undefined);
  }

  /** One heartbeat cycle. Public so it can be driven directly in tests. */
  async beat(): Promise<void> {
    if (!this.sessionId || this.beating) return;
    this.beating = true;
    try {
      const window = this.sampler.flush();
      const res = await this.api.heartbeat(this.sessionId, window);
      this.applyState(res.state, res.prompt);
    } catch (err) {
      await this.handleError(err);
    } finally {
      this.beating = false;
    }
  }

  /** Called by the UI when the person clicks or types the code. Returns an error message to show, or null. */
  async answerPrompt(promptId: string, answer?: string): Promise<string | null> {
    try {
      await this.api.respondToPrompt(promptId, answer);
      this.dismissPrompt();
      this.ui.setStatus({ kind: 'tracking' });
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const left = err.body?.attemptsLeft ?? 0;
        if (left === 0) this.dismissPrompt();
        return left > 0 ? `That code is wrong. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code was wrong too many times. Your manager has been told.';
      }
      if (err instanceof ApiError && err.status === 409) {
        this.dismissPrompt();
        return 'Time ran out for this prompt.';
      }
      return 'Could not reach the server. Try again.';
    }
  }

  private applyState(state: SessionState, prompt: PromptInfo | null) {
    if (prompt) {
      if (this.shownPromptId !== prompt.id) {
        this.shownPromptId = prompt.id;
        this.ui.showPrompt(prompt);
      }
    } else if (this.shownPromptId) {
      this.dismissPrompt();
    }
    if (state === 'absent') this.ui.setStatus({ kind: 'away', message: 'Marked away. Move the mouse to resume.' });
    else this.ui.setStatus({ kind: 'tracking' });
  }

  private dismissPrompt() {
    if (this.shownPromptId) this.ui.hidePrompt();
    this.shownPromptId = null;
  }

  private async handleError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      // Revoked device, deactivated account or a bad secret. Retrying won't help.
      this.clearTimers();
      this.sessionId = null;
      this.ui.setStatus({ kind: 'rejected', message: 'This device is no longer authorised. Ask HR, then sign in again.' });
    } else if (err instanceof ApiError && err.status === 409) {
      // The server closed the session (for example it was superseded or timed out). Open a fresh one.
      try {
        this.sessionId = (await this.api.startSession()).sessionId;
        this.ui.setStatus({ kind: 'tracking' });
      } catch {
        this.ui.setStatus({ kind: 'reconnecting' });
      }
    } else {
      // Network trouble: keep going, the next heartbeat will catch up. The server records the gap as offline.
      this.ui.setStatus({ kind: 'reconnecting' });
    }
  }

  private clearTimers() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.beatTimer) clearInterval(this.beatTimer);
    this.pollTimer = this.beatTimer = undefined;
  }
}
