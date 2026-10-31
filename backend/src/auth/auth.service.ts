import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { CryptoService } from '../crypto/crypto.service';
import { DbService } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { AuthSession, AuthUser, SessionStage } from '../common/request-context';
import { permissionsFor } from '../rbac/roles';
import { passwordProblem } from './password-policy';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

export interface Ctx {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionGrant {
  stage: SessionStage;
  token: string;
  maxAgeMs: number;
}

const RECOVERY_CODE_COUNT = 10;
const GENERIC = 'Invalid credentials';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Step 1. Org ID and password. Never says which of the two was wrong, or whether the account exists. */
  async login(orgId: string, password: string, ctx: Ctx): Promise<SessionGrant> {
    const res = await this.db.query(
      `SELECT id, org_id, password_hash, active, must_change_password, mfa_enabled,
              (locked_until IS NOT NULL AND locked_until > now()) AS locked
         FROM users WHERE lower(org_id) = lower($1)`,
      [orgId],
    );
    const user = res.rows[0];

    if (!user || !user.active || user.locked) {
      await this.crypto.dummyVerify(password); // same CPU cost as a real check, whichever way this branch was reached
      await this.audit.record({
        action: 'auth.login', outcome: 'failure', actorId: user?.id, actorOrgId: orgId.slice(0, 64),
        details: { step: 'password', reason: !user ? 'unknown_org_id' : !user.active ? 'inactive' : 'locked' },
        ...ctx,
      });
      throw new UnauthorizedException(GENERIC);
    }

    if (!(await this.crypto.verifyPassword(password, user.password_hash))) {
      const locked = await this.registerFailure(user.id);
      await this.audit.record({
        action: 'auth.login', outcome: 'failure', actorId: user.id, actorOrgId: user.org_id,
        details: { step: 'password', reason: 'bad_password', lockedNow: locked }, ...ctx,
      });
      throw new UnauthorizedException(GENERIC);
    }

    const stage: SessionStage = user.must_change_password
      ? 'pending_password'
      : user.mfa_enabled ? 'pending_mfa' : 'pending_enroll';
    const grant = await this.grant(user.id, stage, ctx);
    await this.audit.record({
      action: 'auth.password_verified', actorId: user.id, actorOrgId: user.org_id, details: { next: stage }, ...ctx,
    });
    return grant;
  }

  /** Step 2 for someone with MFA set up: authenticator code, or a one-time recovery code. */
  async verifyMfa(user: AuthUser, session: AuthSession, code: string, ctx: Ctx): Promise<{ grant: SessionGrant; usedRecoveryCode: boolean }> {
    const row = (await this.db.query(
      `SELECT mfa_secret_enc, (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM users WHERE id = $1`,
      [user.id],
    )).rows[0];
    if (!row || row.locked) {
      await this.sessions.revoke(session.id);
      throw new UnauthorizedException(GENERIC);
    }

    let method: 'totp' | 'recovery' | null = null;
    if (/^\d{6}$/.test(code)) {
      const step = this.totp.check(this.crypto.decrypt(row.mfa_secret_enc), code);
      if (step !== null && (await this.acceptStep(user.id, step))) method = 'totp';
    } else {
      const used = await this.db.query(
        'UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id',
        [user.id, this.recoveryHash(user.id, code)],
      );
      if (used.rowCount) method = 'recovery';
    }

    if (!method) {
      const locked = await this.registerFailure(user.id);
      if (locked) await this.sessions.revoke(session.id);
      await this.audit.record({
        action: 'auth.login', outcome: 'failure', actorId: user.id, actorOrgId: user.orgId,
        details: { step: 'mfa', reason: 'bad_code', lockedNow: locked }, ...ctx,
      });
      throw new UnauthorizedException(GENERIC);
    }

    const grant = await this.completeSignIn(user, session, ctx, { method });
    if (method === 'recovery') {
      const left = await this.db.query('SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      await this.audit.record({
        action: 'auth.recovery_code_used', actorId: user.id, actorOrgId: user.orgId, details: { remaining: left.rows[0].n }, ...ctx,
      });
    }
    return { grant, usedRecoveryCode: method === 'recovery' };
  }

  /** First sign-in for an account without MFA: hand out a secret to scan. */
  async enrollStart(user: AuthUser, ctx: Ctx): Promise<{ secret: string; otpauthUri: string; qrDataUrl: string }> {
    if (user.mfaEnabled) throw new ConflictException('MFA is already set up for this account');
    const secret = this.totp.generateSecret();
    await this.db.query('UPDATE users SET mfa_secret_enc = $2, updated_at = now() WHERE id = $1 AND NOT mfa_enabled', [
      user.id,
      this.crypto.encrypt(secret),
    ]);
    await this.audit.record({ action: 'auth.mfa_enroll_started', actorId: user.id, actorOrgId: user.orgId, ...ctx });
    const otpauthUri = this.totp.uri(user.orgId, secret);
    return { secret, otpauthUri, qrDataUrl: await this.totp.qrDataUrl(otpauthUri) };
  }

  /** Prove the authenticator works, switch MFA on, and issue recovery codes (shown once). */
  async enrollConfirm(user: AuthUser, session: AuthSession, code: string, ctx: Ctx): Promise<{ grant: SessionGrant; recoveryCodes: string[] }> {
    const row = (await this.db.query('SELECT mfa_secret_enc, mfa_enabled FROM users WHERE id = $1', [user.id])).rows[0];
    if (!row?.mfa_secret_enc || row.mfa_enabled) throw new BadRequestException('Start MFA setup first');

    const step = this.totp.check(this.crypto.decrypt(row.mfa_secret_enc), code);
    if (step === null) {
      const locked = await this.registerFailure(user.id);
      if (locked) await this.sessions.revoke(session.id);
      await this.audit.record({
        action: 'auth.mfa_enroll_confirmed', outcome: 'failure', actorId: user.id, actorOrgId: user.orgId,
        details: { reason: 'bad_code', lockedNow: locked }, ...ctx,
      });
      throw new UnauthorizedException('That code is not correct');
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => this.crypto.recoveryCode());
    await this.db.tx(async (c) => {
      await c.query('UPDATE users SET mfa_enabled = true, mfa_last_step = $2, updated_at = now() WHERE id = $1', [user.id, step]);
      await c.query('DELETE FROM recovery_codes WHERE user_id = $1', [user.id]);
      for (const code of codes) {
        await c.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)', [user.id, this.recoveryHash(user.id, code)]);
      }
      await this.audit.record({ action: 'auth.mfa_enroll_confirmed', actorId: user.id, actorOrgId: user.orgId, ...ctx }, c);
    });
    const grant = await this.completeSignIn({ ...user, mfaEnabled: true }, session, ctx, { method: 'enroll' });
    return { grant, recoveryCodes: codes };
  }

  /**
   * Change password. In 'pending_password' (a temporary password) it moves on to MFA; in an active
   * session it keeps this session and signs every other one out.
   */
  async changePassword(user: AuthUser, session: AuthSession, current: string, next: string, ctx: Ctx): Promise<SessionGrant | null> {
    const row = (await this.db.query('SELECT password_hash, email FROM users WHERE id = $1', [user.id])).rows[0];
    if (!row || !(await this.crypto.verifyPassword(current, row.password_hash))) {
      const locked = await this.registerFailure(user.id);
      if (locked) await this.sessions.revoke(session.id);
      await this.audit.record({
        action: 'auth.password_changed', outcome: 'failure', actorId: user.id, actorOrgId: user.orgId,
        details: { reason: 'bad_current_password', lockedNow: locked }, ...ctx,
      });
      throw new UnauthorizedException('Current password is not correct');
    }
    const problem = passwordProblem(next, { orgId: user.orgId, email: row.email, current });
    if (problem) throw new BadRequestException(problem);

    const hash = await this.crypto.hashPassword(next);
    return this.db.tx(async (c) => {
      await c.query(
        'UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(), updated_at = now() WHERE id = $1',
        [user.id, hash],
      );
      await this.audit.record({ action: 'auth.password_changed', actorId: user.id, actorOrgId: user.orgId, ...ctx }, c);
      if (session.stage === 'pending_password') {
        await this.sessions.revokeAllForUser(user.id, undefined, c);
        const stage: SessionStage = user.mfaEnabled ? 'pending_mfa' : 'pending_enroll';
        return { stage, ...(await this.sessions.create(user.id, stage, ctx, c)) };
      }
      await this.sessions.revokeAllForUser(user.id, session.id, c);
      return null;
    });
  }

  async logout(user: AuthUser, session: AuthSession, ctx: Ctx): Promise<void> {
    await this.sessions.revoke(session.id);
    if (session.stage === 'active') {
      await this.audit.record({ action: 'auth.logout', actorId: user.id, actorOrgId: user.orgId, ...ctx });
    }
  }

  me(user: AuthUser) {
    return {
      id: user.id,
      orgId: user.orgId,
      name: user.name,
      email: user.email,
      role: user.role,
      title: user.title,
      permissions: permissionsFor(user.role),
    };
  }

  // ---- internals -------------------------------------------------------------------------------

  /** Counts a failed password or MFA attempt. Returns true if this one locked the account. */
  private async registerFailure(userId: string): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE users SET
          locked_until    = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
          failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END
        WHERE id = $1
    RETURNING (failed_attempts = 0) AS locked`,
      [userId, this.config.maxFailedAttempts, this.config.lockoutMinutes],
    );
    return res.rows[0]?.locked === true;
  }

  /** Accept a TOTP step only once: a captured code cannot be replayed within its 30-second window. */
  private async acceptStep(userId: string, step: number): Promise<boolean> {
    const res = await this.db.query('UPDATE users SET mfa_last_step = $2 WHERE id = $1 AND mfa_last_step < $2', [userId, step]);
    return (res.rowCount ?? 0) > 0;
  }

  private recoveryHash(userId: string, code: string): string {
    return this.crypto.sha256(`${userId}:${code.trim().toUpperCase()}`);
  }

  private async grant(userId: string, stage: SessionStage, ctx: Ctx): Promise<SessionGrant> {
    return { stage, ...(await this.sessions.create(userId, stage, ctx)) };
  }

  /** Swap the pending session for a fresh full one (new token, so a stolen pending token is worthless). */
  private async completeSignIn(user: AuthUser, session: AuthSession, ctx: Ctx, details: Record<string, unknown>): Promise<SessionGrant> {
    return this.db.tx(async (c) => {
      await this.sessions.revoke(session.id, c);
      await c.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
      const created = await this.sessions.create(user.id, 'active', ctx, c);
      await this.audit.record({ action: 'auth.login', actorId: user.id, actorOrgId: user.orgId, details, ...ctx }, c);
      return { stage: 'active' as const, ...created };
    });
  }
}
