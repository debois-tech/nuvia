import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export type Role = 'employee' | 'team_lead' | 'hr_admin' | 'executive';
export type WorkMode = 'office' | 'remote';

export interface AuthUser {
  id: string;
  orgId: string;
  name: string;
  role: Role;
  workMode: WorkMode;
  managerId: string | null;
}

export interface DeviceContext {
  id: string;
  userId: string;
}

export interface AuthedRequest extends Request {
  user: AuthUser;
  device?: DeviceContext;
  rawBody?: Buffer;
}

export const IS_PUBLIC = 'isPublic';
/** Skips the bearer-token guard. Use only on endpoints that authenticate some other way. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
/** Restricts an endpoint to these roles. Enforced on the server by RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Roles that can see people other than themselves. */
export const REVIEWER_ROLES: Role[] = ['team_lead', 'hr_admin', 'executive'];
