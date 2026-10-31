import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig, CONFIG } from '../config/config';
import { AppRequest } from '../common/request-context';
import { PASSWORD_CHANGE_KEY, PENDING_KEY, PUBLIC_KEY } from '../rbac/decorators';
import { SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Global guard: CSRF origin check, then session lookup, then the stage rules. Runs before the permission check. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const targets = [context.getHandler(), context.getClass()];

    // The cookie is SameSite=Strict already. This is the second layer: a browser always sends Origin
    // on a cross-site POST, so a mismatch is rejected whatever the cookie says.
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== this.config.appOrigin) throw new ForbiddenException('Cross-origin request refused');
    }

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const token = req.cookies?.[this.sessions.cookieName];
    if (!token || typeof token !== 'string') throw new UnauthorizedException();
    const found = await this.sessions.resolve(token);
    if (!found) throw new UnauthorizedException();
    req.user = found.user;
    req.session = found.session;

    if (found.session.stage !== 'active') {
      const allowed = this.reflector.getAllAndOverride<string[]>(PENDING_KEY, targets) ?? [];
      if (!allowed.includes(found.session.stage)) {
        throw new ForbiddenException({ code: 'SIGN_IN_INCOMPLETE', stage: found.session.stage });
      }
      return true;
    }

    if (found.user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_KEY, targets)) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    return true;
  }
}
