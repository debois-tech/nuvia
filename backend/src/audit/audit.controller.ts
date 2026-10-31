import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AuditView, RequirePermission } from '../rbac/decorators';
import { AuditOutcome, AuditService } from './audit.service';

const OUTCOMES = ['success', 'failure', 'denied'];

function date(name: string, v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} is not a valid date`);
  return d;
}

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit:read')
  @AuditView('audit.view', 'audit_log')
  async list(
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('target') target?: string,
    @Query('outcome') outcome?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    if (outcome && !OUTCOMES.includes(outcome)) throw new BadRequestException('outcome must be success, failure or denied');
    if (before && !/^\d{1,18}$/.test(before)) throw new BadRequestException('before must be an event id');
    const n = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    const rows = await this.audit.search({
      actorOrgId: actor, action, targetId: target, outcome: outcome as AuditOutcome | undefined,
      from: date('from', from), to: date('to', to), beforeId: before, limit: n,
    });
    return {
      events: rows.map((r) => ({
        id: r.id, ts: r.ts, actor: r.actor_org_id, actorId: r.actor_id, action: r.action, outcome: r.outcome,
        targetType: r.target_type, targetId: r.target_id, ip: r.ip, userAgent: r.user_agent, details: r.details,
      })),
      nextBefore: rows.length === n ? rows[rows.length - 1].id : null,
    };
  }

  /** Re-computes the whole hash chain. A tampered or missing row shows up as ok: false. */
  @Get('verify')
  @RequirePermission('audit:read')
  @AuditView('audit.verify', 'audit_log')
  verify() {
    return this.audit.verifyChain();
  }
}
