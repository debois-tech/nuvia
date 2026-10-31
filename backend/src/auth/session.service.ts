import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { CryptoService } from '../crypto/crypto.service';
import { DbService, Queryable } from '../db/db.service';
import { AuthSession, AuthUser, SessionStage } from '../common/request-context';

@Injectable()
export class SessionService {
  constructor(
    private readonly db: DbService,
    private readonly crypto: CryptoService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  get cookieName(): string {
    // __Host- pins the cookie to this exact host, over HTTPS, with no Domain attribute.
    return this.config.cookieSecure ? '__Host-nuvia_sid' : 'nuvia_sid';
  }

  cookieOptions(maxAgeMs: number) {
    return { httpOnly: true, secure: this.config.cookieSecure, sameSite: 'strict' as const, path: '/', maxAge: maxAgeMs };
  }

  /** Create a session and return the raw token. Only its hash is stored. */
  async create(
    userId: string,
    stage: SessionStage,
    ctx: { ip?: string | null; userAgent?: string | null },
    client: Queryable = this.db,
  ): Promise<{ token: string; maxAgeMs: number }> {
    const token = this.crypto.randomToken();
    const maxAgeMs =
      stage === 'active' ? this.config.sessionAbsoluteHours * 3600_000 : this.config.pendingSessionMinutes * 60_000;
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, stage, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval, $5, $6)`,
      [userId, this.crypto.sha256(token), stage, String(maxAgeMs), ctx.ip ?? null, ctx.userAgent?.slice(0, 300) ?? null],
    );
    return { token, maxAgeMs };
  }

  /** Look up a cookie token. Returns null for unknown, revoked, expired or idle sessions and for disabled users. */
  async resolve(token: string): Promise<{ user: AuthUser; session: AuthSession } | null> {
    const idleMs = this.config.sessionIdleMinutes * 60_000;
    const res = await this.db.query(
      `SELECT s.id AS session_id, s.stage, s.last_seen_at,
              u.id, u.org_id, u.name, u.email, u.role, u.title, u.must_change_password, u.mfa_enabled
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND u.active
          AND (s.stage <> 'active' OR s.last_seen_at > now() - ($2 || ' milliseconds')::interval)`,
      [this.crypto.sha256(token), String(idleMs)],
    );
    const row = res.rows[0];
    if (!row) return null;
    // Touch at most once a minute so reads do not become writes.
    if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
      await this.db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
    }
    return {
      session: { id: row.session_id, userId: row.id, stage: row.stage },
      user: {
        id: row.id,
        orgId: row.org_id,
        name: row.name,
        email: row.email,
        role: row.role,
        title: row.title,
        mustChangePassword: row.must_change_password,
        mfaEnabled: row.mfa_enabled,
      },
    };
  }

  async revoke(sessionId: string, client: Queryable = this.db): Promise<void> {
    await client.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string, client: Queryable = this.db): Promise<void> {
    await client.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [userId, exceptSessionId ?? null],
    );
  }
}
