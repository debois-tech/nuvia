import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthedRequest } from '../../auth/roles';
import { Clock } from '../../common/clock';
import { parse } from '../../common/zod';
import { DATE_RE, workDateOf } from '../../common/tz';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { MeService } from './me.service';

const NoteBody = z.object({ text: z.string().trim().min(1).max(1000) }).strict();

/** Everything an employee sees about their own attendance. Always scoped to the signed-in person. */
@Controller('attendance/me')
export class MeController {
  constructor(private readonly me: MeService, private readonly clock: Clock, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Get('today')
  today(@Req() req: AuthedRequest) {
    return this.me.today(req.user);
  }

  @Get('activity')
  activity(@Req() req: AuthedRequest, @Query('date') date?: string) {
    const d = date ?? workDateOf(this.clock.now(), this.cfg.timezone);
    if (!DATE_RE.test(d)) throw new BadRequestException('date must be YYYY-MM-DD');
    return this.me.activity(req.user.id, d);
  }

  @Post('flags/:id/note')
  @HttpCode(204)
  async note(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    await this.me.addNote(req.user, id, parse(NoteBody, body).text);
  }
}
