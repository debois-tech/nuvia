import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { AuthedRequest, Public } from '../../auth/roles';
import { parse } from '../../common/zod';
import { DeviceAuthGuard } from './device-auth.guard';
import { HeartbeatSchema, PromptResponseSchema, SessionStartSchema, SessionStopSchema } from './schemas';
import { SessionsService } from './sessions.service';

/** Endpoints the desktop agent calls. Authenticated by device signature (see DeviceAuthGuard), not bearer token. */
@Public()
@UseGuards(DeviceAuthGuard)
@Controller('agent')
export class AgentController {
  constructor(private readonly sessions: SessionsService) {}

  @Post('session/start')
  @HttpCode(200)
  start(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.sessions.start(req.device!, parse(SessionStartSchema, body).seq);
  }

  @Post('session/stop')
  @HttpCode(204)
  async stop(@Req() req: AuthedRequest, @Body() body: unknown) {
    const b = parse(SessionStopSchema, body);
    await this.sessions.stop(req.device!, b.sessionId, b.seq);
  }

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.sessions.heartbeat(req.device!, parse(HeartbeatSchema, body));
  }

  @Post('prompts/:id/respond')
  @HttpCode(200)
  async respond(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(PromptResponseSchema, body);
    const r = await this.sessions.respondToPrompt(req.device!, id, b.seq, b.answer);
    if (!r.ok) throw new UnprocessableEntityException({ message: 'Wrong code', attemptsLeft: r.attemptsLeft });
    return r;
  }
}
