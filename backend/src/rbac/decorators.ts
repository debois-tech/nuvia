import { SetMetadata } from '@nestjs/common';
import { Permission } from './roles';

export const PUBLIC_KEY = 'nuvia:public';
export const PENDING_KEY = 'nuvia:pending-stages';
export const PASSWORD_CHANGE_KEY = 'nuvia:allow-password-change';
export const PERMISSION_KEY = 'nuvia:permissions';
export const AUDIT_VIEW_KEY = 'nuvia:audit-view';

/** No session needed. Use sparingly: login and health only. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Allow a half-finished sign-in (password accepted, MFA still to do) on this route. */
export const AllowStages = (...stages: Array<'pending_password' | 'pending_mfa' | 'pending_enroll'>) => SetMetadata(PENDING_KEY, stages);

/** Allow a user who must still change their temporary password. */
export const AllowPasswordChange = () => SetMetadata(PASSWORD_CHANGE_KEY, true);

/** The caller's role must hold ALL listed permissions. Routes with no decorator need only a full sign-in. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSION_KEY, permissions);

/** Record that someone viewed this resource, e.g. @AuditView('users.list', 'user'). */
export const AuditView = (action: string, targetType?: string) =>
  SetMetadata(AUDIT_VIEW_KEY, { action, targetType });
