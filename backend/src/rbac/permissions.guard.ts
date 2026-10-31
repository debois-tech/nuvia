import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../audit/audit.service';
import { AppRequest, clientInfo } from '../common/request-context';
import { PERMISSION_KEY } from './decorators';
import { can, Permission } from './roles';

/** Global guard: decides on the server, from the role stored in the database, never from anything the client sends. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly audit: AuditService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const user = req.user;
    if (user && required.every((p) => can(user.role, p))) return true;

    await this.audit.record({
      action: 'access.denied',
      outcome: 'denied',
      actorId: user?.id,
      actorOrgId: user?.orgId,
      details: { method: req.method, path: req.route?.path ?? req.path, required },
      ...clientInfo(req),
    });
    throw new ForbiddenException('You do not have permission to do this');
  }
}
