import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { AuthedRequest } from '../auth/roles';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query('unread') unread?: string) {
    return this.svc.list(req.user.id, unread === '1' || unread === 'true');
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@Req() req: AuthedRequest) {
    await this.svc.markAllRead(req.user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.markRead(req.user.id, id);
  }
}
