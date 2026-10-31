import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { AuthedRequest, Roles } from '../../auth/roles';
import { parse } from '../../common/zod';
import { DATE_RE } from '../../common/tz';
import { MeService } from '../me/me.service';
import { ReviewService } from './review.service';

const ResolveBody = z.object({ decision: z.enum(['confirmed', 'dismissed', 'excused']), note: z.string().trim().min(1).max(1000) }).strict();
const ListQuery = z.object({
  status: z.enum(['open', 'confirmed', 'dismissed', 'excused']).optional(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Review screen API for flagged periods. Leads: their team. HR/admin and executives: everyone. */
@Controller('attendance/review')
@Roles('team_lead', 'hr_admin', 'executive')
export class ReviewController {
  constructor(private readonly review: ReviewService, private readonly me: MeService, private readonly audit: AuditService) {}

  @Get('flags')
  list(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.review.list(req.user, parse(ListQuery, query));
  }

  @Get('flags/:id')
  detail(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.detail(req.user, id);
  }

  @Post('flags/:id/resolve')
  @Roles('team_lead', 'hr_admin')
  @HttpCode(204)
  async resolve(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(ResolveBody, body);
    await this.review.resolve(req.user, id, b.decision, b.note);
  }

  @Get('users/:userId/activity')
  async activity(@Req() req: AuthedRequest, @Param('userId', ParseUUIDPipe) userId: string, @Query('date') date?: string) {
    if (!date || !DATE_RE.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    await this.review.assertCanView(req.user, userId);
    await this.audit.record(req.user.id, 'activity.view', { type: 'user', id: userId }, { date });
    return this.me.activity(userId, date);
  }
}
