import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { Q } from '../../common/db.service';
import { formatTime } from '../../common/tz';
import { NotificationsService } from '../../notifications/notifications.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import type { Severity } from './anticheat';

export interface RaiseFlag {
  user: { id: string; name: string; orgId: string };
  sessionId: string | null;
  periodId?: string | null;
  promptId?: string | null;
  kind: string;
  severity: Severity;
  detail?: Record<string, unknown>;
  /** Skip if the same kind was already raised for this session within this many minutes. */
  dedupeMinutes?: number;
}

const MESSAGES: Record<string, (who: string, at: string) => string> = {
  absent: (who, at) => `${who} was marked absent at ${at}: no response to the activity prompt.`,
  challenge_failed: (who, at) => `${who} did not pass a random presence check at ${at}.`,
  agent_offline: (who, at) => `${who}'s desktop agent stopped reporting at ${at}.`,
};

@Injectable()
export class FlagsService {
  constructor(private readonly clock: Clock, private readonly notifications: NotificationsService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** Creates a review flag and, for medium and high severity, alerts the person's manager. Returns the flag id, or null if deduplicated. */
  async raise(q: Q, f: RaiseFlag): Promise<string | null> {
    const now = this.clock.now();
    if (f.dedupeMinutes && f.sessionId) {
      const since = new Date(now.getTime() - f.dedupeMinutes * 60_000);
      const dup = await q.query('SELECT 1 FROM review_flags WHERE session_id = $1 AND kind = $2 AND created_at > $3 LIMIT 1', [f.sessionId, f.kind, since]);
      if (dup.rowCount) return null;
    }
    const { rows } = await q.query(
      `INSERT INTO review_flags (user_id, session_id, period_id, prompt_id, kind, severity, detail, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [f.user.id, f.sessionId, f.periodId ?? null, f.promptId ?? null, f.kind, f.severity, JSON.stringify(f.detail ?? {}), now],
    );
    const id = rows[0].id as string;
    if (f.severity !== 'low') {
      const at = formatTime(now, this.cfg.timezone);
      const who = `${f.user.name} (${f.user.orgId})`;
      const message = (MESSAGES[f.kind] ?? ((w, t) => `${w}: input pattern at ${t} looks scripted (${f.kind.replace(/_/g, ' ')}). Review before drawing conclusions.`))(who, at);
      await this.notifications.notifyManagersOf(q, f.user.id, 'attendance_flag', message, id);
    }
    return id;
  }
}
