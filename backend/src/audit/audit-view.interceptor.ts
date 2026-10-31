import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, mergeMap } from 'rxjs';
import { AppRequest, clientInfo } from '../common/request-context';
import { AUDIT_VIEW_KEY } from '../rbac/decorators';
import { AuditService } from './audit.service';

/**
 * Records "who looked at what" for routes marked @AuditView. The event is written before the response
 * leaves: if the audit write fails the request fails, so nothing is read without a trace.
 */
@Injectable()
export class AuditViewInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<{ action: string; targetType?: string }>(AUDIT_VIEW_KEY, context.getHandler());
    if (!meta) return next.handle();
    const req = context.switchToHttp().getRequest<AppRequest>();
    return next.handle().pipe(
      mergeMap(async (data) => {
        await this.audit.record({
          action: meta.action,
          actorId: req.user?.id,
          actorOrgId: req.user?.orgId,
          targetType: meta.targetType,
          targetId: typeof req.params?.id === 'string' ? req.params.id : undefined,
          details: { query: req.query },
          ...clientInfo(req),
        });
        return data;
      }),
    );
  }
}
