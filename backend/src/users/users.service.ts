import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/request-context';
import { CryptoService } from '../crypto/crypto.service';
import { DbService } from '../db/db.service';
import { SessionService } from '../auth/session.service';
import { Role } from '../rbac/roles';
import { Ctx } from '../auth/auth.service';
import { CreateUserDto, UpdateUserDto } from './users.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PUBLIC_COLUMNS = `id, org_id AS "orgId", name, email, role, title, active, mfa_enabled AS "mfaEnabled",
  must_change_password AS "mustChangePassword", created_at AS "createdAt", updated_at AS "updatedAt"`;

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async list() {
    return (await this.db.query(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY lower(org_id)`)).rows;
  }

  async get(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('User not found');
    const row = (await this.db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id])).rows[0];
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  /** Admin-created accounts only. The temporary password is returned once and must be changed at first sign-in. */
  async create(dto: CreateUserDto, actor: AuthUser | null, ctx: Ctx) {
    const temp = this.crypto.tempPassword();
    const hash = await this.crypto.hashPassword(temp);
    try {
      const row = await this.db.tx(async (c) => {
        const res = await c.query(
          `INSERT INTO users (org_id, name, email, role, title, password_hash, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${PUBLIC_COLUMNS}`,
          [dto.orgId, dto.name.trim(), dto.email.trim(), dto.role, dto.title?.trim() || null, hash, actor?.id ?? null],
        );
        await this.audit.record(
          {
            action: actor ? 'user.created' : 'user.bootstrap_admin_created',
            actorId: actor?.id, actorOrgId: actor?.orgId, targetType: 'user', targetId: res.rows[0].id,
            details: { orgId: dto.orgId, role: dto.role }, ...ctx,
          },
          c,
        );
        return res.rows[0];
      });
      return { user: row, temporaryPassword: temp };
    } catch (err: any) {
      if (err.code === '23505') throw new ConflictException('That org ID or email is already in use');
      throw err;
    }
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser, ctx: Ctx) {
    try {
      return await this.db.tx(async (c) => {
        const current = await this.lockUser(c, id);
        const roleChanging = dto.role !== undefined && dto.role !== current.role;
        const deactivating = dto.active === false && current.active;

        if (id === actor.id && (roleChanging || deactivating)) {
          throw new BadRequestException('You cannot change your own role or deactivate yourself');
        }
        if (current.role === 'hr_admin' && current.active && (roleChanging || deactivating)) {
          await this.requireAnotherAdmin(c, id);
        }

        const res = await c.query(
          `UPDATE users SET
              name   = COALESCE($2, name),
              email  = COALESCE($3, email),
              role   = COALESCE($4, role),
              title  = CASE WHEN $5::boolean THEN $6 ELSE title END,
              active = COALESCE($7, active),
              updated_at = now()
            WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
          [id, dto.name?.trim() ?? null, dto.email?.trim() ?? null, dto.role ?? null, dto.title !== undefined, dto.title?.trim() || null, dto.active ?? null],
        );
        const base = { actorId: actor.id, actorOrgId: actor.orgId, targetType: 'user', targetId: id, ...ctx };
        if (roleChanging) {
          await this.audit.record({ ...base, action: 'user.role_changed', details: { from: current.role, to: dto.role } }, c);
          await this.sessions.revokeAllForUser(id, undefined, c); // permissions changed: sign them in again
        }
        if (deactivating) {
          await this.audit.record({ ...base, action: 'user.deactivated' }, c);
          await this.sessions.revokeAllForUser(id, undefined, c);
        }
        if (dto.active === true && !current.active) await this.audit.record({ ...base, action: 'user.reactivated' }, c);
        const profileChanged = ['name', 'email', 'title'].filter((k) => (dto as any)[k] !== undefined && (dto as any)[k] !== current[k]);
        if (profileChanged.length) await this.audit.record({ ...base, action: 'user.updated', details: { fields: profileChanged } }, c);
        return res.rows[0];
      });
    } catch (err: any) {
      if (err.code === '23505') throw new ConflictException('That email is already in use');
      throw err;
    }
  }

  /** New temporary password, all sessions ended, must change at next sign-in. Audited. */
  async resetPassword(id: string, actor: AuthUser, ctx: Ctx) {
    const temp = this.crypto.tempPassword();
    const hash = await this.crypto.hashPassword(temp);
    await this.db.tx(async (c) => {
      await this.lockUser(c, id);
      await c.query(
        `UPDATE users SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
        [id, hash],
      );
      await this.sessions.revokeAllForUser(id, undefined, c);
      await this.audit.record({ action: 'user.password_reset', actorId: actor.id, actorOrgId: actor.orgId, targetType: 'user', targetId: id, ...ctx }, c);
    });
    return { temporaryPassword: temp };
  }

  /** For a lost phone with no recovery codes. They set MFA up again at next sign-in. */
  async resetMfa(id: string, actor: AuthUser, ctx: Ctx) {
    await this.db.tx(async (c) => {
      await this.lockUser(c, id);
      await c.query(`UPDATE users SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_last_step = 0, updated_at = now() WHERE id = $1`, [id]);
      await c.query('DELETE FROM recovery_codes WHERE user_id = $1', [id]);
      await this.sessions.revokeAllForUser(id, undefined, c);
      await this.audit.record({ action: 'user.mfa_reset', actorId: actor.id, actorOrgId: actor.orgId, targetType: 'user', targetId: id, ...ctx }, c);
    });
  }

  private async lockUser(c: PoolClient, id: string): Promise<{ role: Role; active: boolean; [k: string]: any }> {
    if (!UUID.test(id)) throw new NotFoundException('User not found');
    const res = await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!res.rows[0]) throw new NotFoundException('User not found');
    return res.rows[0];
  }

  /** The company must never be left without someone who can manage users. */
  private async requireAnotherAdmin(c: PoolClient, excludingId: string) {
    const res = await c.query(`SELECT id FROM users WHERE role = 'hr_admin' AND active AND id <> $1 FOR UPDATE`, [excludingId]);
    if (res.rowCount === 0) throw new BadRequestException('This is the last active HR/admin account');
  }
}
