import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { AuthedRequest } from '../../auth/roles';
import { parse } from '../../common/zod';
import { DevicesService } from './devices.service';
import { EnrollSchema } from './schemas';

/** Enrolling, listing and revoking desktop agent installs. Signed in with the normal portal login. */
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @HttpCode(201)
  enroll(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.devices.enroll(req.user, parse(EnrollSchema, body).name);
  }

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.devices.list(req.user.id);
  }

  @Post(':id/revoke')
  @HttpCode(204)
  async revoke(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.devices.revoke(req.user, id);
  }
}
