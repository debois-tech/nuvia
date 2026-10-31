import { Controller, Get, HttpCode, Post, Query, Req, BadRequestException } from '@nestjs/common';
import { AuthedRequest, Roles } from '../../auth/roles';
import { Clock } from '../../common/clock';
import { DATE_RE, workDateOf } from '../../common/tz';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { OfficeService } from './office.service';

@Controller('attendance/office')
export class OfficeController {
  constructor(private readonly office: OfficeService, private readonly clock: Clock, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Post('check-in')
  @HttpCode(201)
  checkIn(@Req() req: AuthedRequest) {
    return this.office.checkIn(req.user, req.ip);
  }

  @Post('check-out')
  @HttpCode(200)
  checkOut(@Req() req: AuthedRequest) {
    return this.office.checkOut(req.user, req.ip);
  }

  @Get('today')
  today(@Req() req: AuthedRequest) {
    return this.office.today(req.user);
  }

  @Get('history')
  history(@Req() req: AuthedRequest, @Query('from') from?: string, @Query('to') to?: string) {
    const today = workDateOf(this.clock.now(), this.cfg.timezone);
    const f = from ?? '0001-01-01';
    const t = to ?? today;
    if (!DATE_RE.test(f) || !DATE_RE.test(t)) throw new BadRequestException('from and to must be YYYY-MM-DD');
    return this.office.history(req.user.id, f, t);
  }

  /** Team view: leads see their own reports, HR/admin and executives see everyone. */
  @Get('day')
  @Roles('team_lead', 'hr_admin', 'executive')
  day(@Req() req: AuthedRequest, @Query('date') date?: string) {
    const d = date ?? workDateOf(this.clock.now(), this.cfg.timezone);
    if (!DATE_RE.test(d)) throw new BadRequestException('date must be YYYY-MM-DD');
    return this.office.day(req.user, d);
  }
}
