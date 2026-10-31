import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DbService } from '../common/db.service';
import { AuthUser } from './roles';
import { hashPassword, verifyPassword } from './password';

// Verified against when the org ID is unknown, so response time doesn't reveal which IDs exist.
let dummyHash: Promise<string> | undefined;

const USER_COLS = `id, org_id, name, role, work_mode, manager_id, active`;

export function toAuthUser(r: any): AuthUser {
  return { id: r.id, orgId: r.orgId, name: r.name, role: r.role, workMode: r.workMode, managerId: r.managerId };
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService, private readonly jwt: JwtService) {}

  async login(orgId: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const { rows } = await this.db.query(`SELECT ${USER_COLS}, password_hash FROM users WHERE org_id = $1`, [orgId]);
    const row = rows[0];
    dummyHash ??= hashPassword('not-a-real-password');
    const ok = await verifyPassword(password, row ? row.passwordHash : await dummyHash);
    if (!row || !ok || !row.active) throw new UnauthorizedException('Invalid org ID or password');
    const user = toAuthUser(row);
    return { token: await this.jwt.signAsync({ sub: user.id }), user };
  }

  async userById(id: string): Promise<AuthUser | null> {
    const { rows } = await this.db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
    return rows[0] && rows[0].active ? toAuthUser(rows[0]) : null;
  }
}
