import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { HeartbeatBody, HeartbeatResponse, PromptInfo, SessionState } from '@nuvia/shared';
import { Clock } from '../../common/clock';
import { DbService, Q } from '../../common/db.service';
import { RandomSource } from '../../common/random';
import { workDateOf } from '../../common/tz';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { analyzePath, evaluateWindow } from './anticheat';
import { DevicesService } from './devices.service';
import { FlagsService } from './flags.service';

const MAX_CHALLENGE_ATTEMPTS = 3;
/** Network and polling delay allowance when someone answers right at the deadline. */
const ANSWER_TOLERANCE_MS = 5_000;

type PeriodKind = 'active' | 'idle' | 'absent' | 'offline';

interface SessionRow {
  id: string;
  userId: string;
  deviceId: string;
  startedAt: Date;
  state: SessionState;
  lastHeartbeatAt: Date;
  lastActivityAt: Date;
  lastChallengeAt: Date | null;
}

export type PromptResult = { ok: true; state: SessionState } | { ok: false; attemptsLeft: number };

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly random: RandomSource,
    private readonly devices: DevicesService,
    private readonly flags: FlagsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ---- timeline helpers -------------------------------------------------------------------

  private async openPeriod(q: Q, s: { id: string; userId: string }, kind: PeriodKind, at: Date): Promise<string> {
    const r = await q.query('INSERT INTO activity_periods (session_id, user_id, kind, started_at) VALUES ($1,$2,$3,$4) RETURNING id', [s.id, s.userId, kind, at]);
    return r.rows[0].id;
  }

  private async closeOpenPeriod(q: Q, sessionId: string, at: Date, kind?: PeriodKind) {
    const r = await q.query(
      `UPDATE activity_periods SET ended_at = GREATEST($2::timestamptz, started_at) ${kind ? ', kind = $3' : ''}
       WHERE session_id = $1 AND ended_at IS NULL RETURNING id, kind, started_at, ended_at`,
      kind ? [sessionId, at, kind] : [sessionId, at],
    );
    const p = r.rows[0] as { id: string; kind: PeriodKind; startedAt: Date; endedAt: Date } | undefined;
    // An "active" period that lasted no time (idle from the very start) is noise on the log, so drop it.
    if (p && p.kind === 'active' && p.startedAt.getTime() === p.endedAt.getTime()) {
      await q.query('DELETE FROM activity_periods WHERE id = $1', [p.id]);
    }
    return p;
  }

  private async lockSession(q: Q, where: string, params: unknown[]): Promise<SessionRow | undefined> {
    const r = await q.query(`SELECT * FROM remote_sessions WHERE ${where} AND ended_at IS NULL FOR UPDATE`, params);
    return r.rows[0];
  }

  private async userOf(q: Q, userId: string) {
    const r = await q.query('SELECT id, name, org_id FROM users WHERE id = $1', [userId]);
    return { id: r.rows[0].id as string, name: r.rows[0].name as string, orgId: r.rows[0].orgId as string };
  }

  private async endSession(q: Q, s: SessionRow, at: Date, reason: 'stopped' | 'superseded' | 'agent_lost') {
    await this.closeOpenPeriod(q, s.id, at, s.state === 'prompted' ? 'idle' : undefined);
    await q.query(`UPDATE prompts SET status = 'expired' WHERE session_id = $1 AND status = 'pending'`, [s.id]);
    await q.query('UPDATE remote_sessions SET ended_at = $2, end_reason = $3 WHERE id = $1', [s.id, at, reason]);
  }

  private async pendingPrompt(q: Q, sessionId: string, now: Date): Promise<PromptInfo | null> {
    const r = await q.query(
      `SELECT id, kind, code, deadline_at FROM prompts WHERE session_id = $1 AND status = 'pending' AND deadline_at > $2 ORDER BY created_at LIMIT 1`,
      [sessionId, now],
    );
    const p = r.rows[0];
    if (!p) return null;
    return { id: p.id, kind: p.kind, deadlineAt: new Date(p.deadlineAt).toISOString(), ...(p.kind === 'challenge' ? { code: p.code } : {}) };
  }

  // ---- agent calls ------------------------------------------------------------------------

  async start(device: { id: string; userId: string }, seq: number) {
    const now = this.clock.now();
    return this.db.tx(async (q) => {
      await this.devices.consumeSeq(q, device.id, seq, now);
      const open = await this.lockSession(q, 'user_id = $1', [device.userId]);
      if (open && open.deviceId === device.id) return { sessionId: open.id, state: open.state, resumed: true };
      if (open) await this.endSession(q, open, now, 'superseded');
      const r = await q.query(
        `INSERT INTO remote_sessions (user_id, device_id, work_date, started_at, last_heartbeat_at, last_activity_at)
         VALUES ($1,$2,$3,$4,$4,$4) RETURNING id`,
        [device.userId, device.id, workDateOf(now, this.cfg.timezone), now],
      );
      await this.openPeriod(q, { id: r.rows[0].id, userId: device.userId }, 'active', now);
      return { sessionId: r.rows[0].id as string, state: 'active' as SessionState, resumed: false };
    });
  }

  async stop(device: { id: string; userId: string }, sessionId: string, seq: number) {
    const now = this.clock.now();
    await this.db.tx(async (q) => {
      await this.devices.consumeSeq(q, device.id, seq, now);
      const s = await this.lockSession(q, 'id = $1 AND user_id = $2 AND device_id = $3', [sessionId, device.userId, device.id]);
      if (!s) throw new NotFoundException('No open session');
      await this.endSession(q, s, now, 'stopped');
    });
  }

  async heartbeat(device: { id: string; userId: string }, body: HeartbeatBody): Promise<HeartbeatResponse> {
    const now = this.clock.now();
    return this.db.tx(async (q) => {
      await this.devices.consumeSeq(q, device.id, body.seq, now);
      const s = await this.lockSession(q, 'id = $1 AND user_id = $2 AND device_id = $3', [body.sessionId, device.userId, device.id]);
      if (!s) throw new ConflictException('Session is not open. Start a new one.');
      const user = await this.userOf(q, s.userId);

      const features = analyzePath(body.steps);
      const recent = (await q.query(`SELECT features->>'stepsHash' AS h FROM heartbeats WHERE session_id = $1 ORDER BY id DESC LIMIT 4`, [s.id])).rows.map((r) => r.h as string | null);
      await q.query(
        `INSERT INTO heartbeats (session_id, user_id, seq, received_at, window_seconds, active_seconds, other_input_events, features)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s.id, s.userId, body.seq, now, body.windowSeconds, body.activeSeconds, body.otherInputEvents, JSON.stringify(features)],
      );

      const hasActivity = body.activeSeconds > 0 || body.steps.length > 0 || body.otherInputEvents > 0;
      let state = s.state;
      let lastActivity = s.lastActivityAt;
      if (state === 'offline' || (state === 'absent' && hasActivity)) {
        // Back online, or back at the keyboard after being marked absent. The gap itself stays on record.
        await this.closeOpenPeriod(q, s.id, now);
        await this.openPeriod(q, s, 'active', now);
        state = 'active';
        lastActivity = now;
      }
      if (hasActivity) lastActivity = now;
      await q.query('UPDATE remote_sessions SET state = $2, last_heartbeat_at = $3, last_activity_at = $4 WHERE id = $1', [s.id, state, now, lastActivity]);

      // One minute of scripted-looking movement often trips several checks at once. Report it as one flag.
      const signals = evaluateWindow(features, recent);
      const patterns = signals.filter((x) => x.kind !== 'scripted_identical_windows');
      const replay = signals.find((x) => x.kind === 'scripted_identical_windows');
      if (patterns.length) {
        const detail = Object.assign({}, ...patterns.map((x) => x.detail), { patterns: patterns.map((x) => x.kind.replace('scripted_', '')) });
        await this.flags.raise(q, { user, sessionId: s.id, kind: 'scripted_movement', severity: 'medium', detail, dedupeMinutes: 30 });
      }
      if (replay) await this.flags.raise(q, { user, sessionId: s.id, kind: replay.kind, severity: replay.severity, detail: replay.detail, dedupeMinutes: 30 });
      if (hasActivity && body.steps.length > 0 && body.otherInputEvents === 0) await this.checkMouseOnly(q, s, user, now);

      return { state, prompt: await this.pendingPrompt(q, s.id, now), serverTime: now.toISOString() };
    });
  }

  /** Hours of activity with no input other than the mouse. Low severity: designers and video calls do this legitimately. */
  private async checkMouseOnly(q: Q, s: SessionRow, user: { id: string; name: string; orgId: string }, now: Date) {
    const hours = this.cfg.mouseOnlyHours;
    if (!hours) return;
    const since = new Date(now.getTime() - hours * 3_600_000);
    if (s.startedAt > since) return;
    const r = await q.query('SELECT 1 FROM heartbeats WHERE session_id = $1 AND other_input_events > 0 AND received_at > $2 LIMIT 1', [s.id, since]);
    if (r.rowCount) return;
    await this.flags.raise(q, { user, sessionId: s.id, kind: 'mouse_only_extended', severity: 'low', detail: { hours }, dedupeMinutes: hours * 60 });
  }

  async respondToPrompt(device: { id: string; userId: string }, promptId: string, seq: number, answer: string | undefined): Promise<PromptResult> {
    const now = this.clock.now();
    return this.db.tx(async (q): Promise<PromptResult> => {
      await this.devices.consumeSeq(q, device.id, seq, now);
      // Lock order is always session first, then prompt, to match the scheduler and avoid deadlocks.
      const owner = await q.query('SELECT session_id FROM prompts WHERE id = $1 AND user_id = $2', [promptId, device.userId]);
      if (!owner.rowCount) throw new NotFoundException();
      const s = await this.lockSession(q, 'id = $1', [owner.rows[0].sessionId]);
      if (!s) throw new ConflictException('This prompt is no longer open');
      const p = (await q.query('SELECT * FROM prompts WHERE id = $1 FOR UPDATE', [promptId])).rows[0];
      if (p.status !== 'pending' || now.getTime() > new Date(p.deadlineAt).getTime() + ANSWER_TOLERANCE_MS) {
        throw new ConflictException('This prompt is no longer open');
      }

      if (p.kind === 'challenge') {
        const given = (answer ?? '').trim();
        if (given !== p.code) {
          const attempts = p.attempts + 1;
          if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
            await q.query(`UPDATE prompts SET attempts = $2, status = 'failed' WHERE id = $1`, [promptId, attempts]);
            await this.flags.raise(q, { user: await this.userOf(q, s.userId), sessionId: s.id, promptId, kind: 'challenge_failed', severity: 'medium', detail: { reason: 'wrong_answer', attempts } });
            return { ok: false, attemptsLeft: 0 };
          }
          await q.query('UPDATE prompts SET attempts = $2 WHERE id = $1', [promptId, attempts]);
          return { ok: false, attemptsLeft: MAX_CHALLENGE_ATTEMPTS - attempts };
        }
        await q.query(`UPDATE prompts SET status = 'answered', answered_at = $2 WHERE id = $1`, [promptId, now]);
        await q.query('UPDATE remote_sessions SET last_activity_at = $2 WHERE id = $1', [s.id, now]);
        return { ok: true, state: s.state };
      }

      // Idle prompt: the person is there. The idle stretch stays on the log as "idle", then active resumes.
      await q.query(`UPDATE prompts SET status = 'answered', answered_at = $2 WHERE id = $1`, [promptId, now]);
      if (s.state === 'prompted') {
        await this.closeOpenPeriod(q, s.id, now, 'idle');
        await this.openPeriod(q, s, 'active', now);
        await q.query(`UPDATE remote_sessions SET state = 'active', last_activity_at = $2 WHERE id = $1`, [s.id, now]);
      }
      return { ok: true, state: 'active' };
    });
  }

  // ---- scheduler --------------------------------------------------------------------------

  async tick(now = this.clock.now()): Promise<void> {
    const ids = (await this.db.query('SELECT id FROM remote_sessions WHERE ended_at IS NULL')).rows.map((r) => r.id as string);
    for (const id of ids) {
      try {
        await this.db.tx((q) => this.processSession(q, id, now));
      } catch (err) {
        console.error(`attendance scheduler: session ${id} failed`, err);
      }
    }
  }

  async purgeOldHeartbeats(now = this.clock.now()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.cfg.heartbeatRetentionDays * 86_400_000);
    return (await this.db.query('DELETE FROM heartbeats WHERE received_at < $1', [cutoff])).rowCount;
  }

  private async processSession(q: Q, sessionId: string, now: Date) {
    const s = await this.lockSession(q, 'id = $1', [sessionId]);
    if (!s) return;
    const user = await this.userOf(q, s.userId);
    const idleMs = this.cfg.idleMinutes * 60_000;

    // 1. The agent went quiet. A prompt can't be shown, so there is nothing to wait for.
    if (s.state !== 'offline' && now.getTime() - s.lastHeartbeatAt.getTime() >= this.cfg.agentOfflineSeconds * 1000) {
      await q.query(`UPDATE prompts SET status = 'expired' WHERE session_id = $1 AND status = 'pending'`, [s.id]);
      await this.closeOpenPeriod(q, s.id, s.lastHeartbeatAt, s.state === 'prompted' ? 'idle' : undefined);
      const periodId = await this.openPeriod(q, s, 'offline', s.lastHeartbeatAt);
      await q.query(`UPDATE remote_sessions SET state = 'offline' WHERE id = $1`, [s.id]);
      await this.flags.raise(q, { user, sessionId: s.id, periodId, kind: 'agent_offline', severity: 'medium', detail: { lastHeartbeatAt: s.lastHeartbeatAt.toISOString() } });
      return;
    }
    if (s.state === 'offline') {
      if (now.getTime() - s.lastHeartbeatAt.getTime() >= this.cfg.offlineAutocloseMinutes * 60_000) await this.endSession(q, s, now, 'agent_lost');
      return;
    }

    // 2. Prompts whose time ran out.
    let state = s.state;
    const overdue = (await q.query(`SELECT * FROM prompts WHERE session_id = $1 AND status = 'pending' AND deadline_at <= $2 FOR UPDATE`, [s.id, now])).rows;
    for (const p of overdue) {
      await q.query(`UPDATE prompts SET status = 'expired' WHERE id = $1`, [p.id]);
      if (p.kind === 'idle') {
        // Not answered: the stretch becomes "absent" and a manager is told. It stays a flag for review, not a verdict.
        const period = await q.query(`UPDATE activity_periods SET kind = 'absent' WHERE session_id = $1 AND ended_at IS NULL RETURNING id`, [s.id]);
        await q.query(`UPDATE remote_sessions SET state = 'absent' WHERE id = $1`, [s.id]);
        state = 'absent';
        await this.flags.raise(q, {
          user, sessionId: s.id, periodId: period.rows[0]?.id, promptId: p.id, kind: 'absent', severity: 'high',
          detail: { idleMinutes: Math.round((now.getTime() - s.lastActivityAt.getTime()) / 60_000) },
        });
      } else {
        await this.flags.raise(q, { user, sessionId: s.id, promptId: p.id, kind: 'challenge_failed', severity: 'medium', detail: { reason: 'no_response' } });
      }
    }

    const hasPending = (await q.query(`SELECT 1 FROM prompts WHERE session_id = $1 AND status = 'pending' LIMIT 1`, [s.id])).rowCount > 0;
    if (state !== 'active' || hasPending) return;

    // 3. Idle for too long: ask the person to confirm they are there.
    if (now.getTime() - s.lastActivityAt.getTime() >= idleMs) {
      await this.closeOpenPeriod(q, s.id, s.lastActivityAt);
      await this.openPeriod(q, s, 'idle', s.lastActivityAt);
      await q.query(`INSERT INTO prompts (session_id, user_id, kind, created_at, deadline_at) VALUES ($1,$2,'idle',$3,$4)`, [
        s.id, s.userId, now, new Date(now.getTime() + this.cfg.promptGraceSeconds * 1000),
      ]);
      await q.query(`UPDATE remote_sessions SET state = 'prompted' WHERE id = $1`, [s.id]);
      return;
    }

    // 4. Random presence check. Looks active, so ask for something a jiggler can't do: type the code on screen.
    const sinceLast = now.getTime() - (s.lastChallengeAt ?? s.startedAt).getTime();
    const meanSec = this.cfg.challengeMeanMinutes * 60;
    if (meanSec > 0 && sinceLast >= this.cfg.challengeMinGapMinutes * 60_000) {
      const p = 1 - Math.exp(-this.cfg.schedulerIntervalSeconds / meanSec);
      if (this.random.chance(p)) {
        await q.query(`INSERT INTO prompts (session_id, user_id, kind, code, created_at, deadline_at) VALUES ($1,$2,'challenge',$3,$4,$5)`, [
          s.id, s.userId, this.random.code(), now, new Date(now.getTime() + this.cfg.promptGraceSeconds * 1000),
        ]);
        await q.query('UPDATE remote_sessions SET last_challenge_at = $2 WHERE id = $1', [s.id, now]);
      }
    }
  }
}
