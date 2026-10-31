import { Request } from 'express';
import { Role } from '../rbac/roles';

export interface AuthUser {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
  title: string | null;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
}

export type SessionStage = 'pending_password' | 'pending_mfa' | 'pending_enroll' | 'active';

export interface AuthSession {
  id: string;
  userId: string;
  stage: SessionStage;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  session?: AuthSession;
}

export function clientInfo(req: Request) {
  return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string | undefined) ?? null };
}
