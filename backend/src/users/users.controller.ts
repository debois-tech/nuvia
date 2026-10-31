import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { AuditView, RequirePermission } from '../rbac/decorators';
import { AppRequest, clientInfo } from '../common/request-context';
import { CreateUserDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users:read')
  @AuditView('users.list', 'user')
  list() {
    return this.users.list();
  }

  @Get(':id')
  @RequirePermission('users:read')
  @AuditView('users.view', 'user')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermission('users:manage')
  create(@Body() dto: CreateUserDto, @Req() req: AppRequest) {
    return this.users.create(dto, req.user!, clientInfo(req));
  }

  @Patch(':id')
  @RequirePermission('users:manage')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: AppRequest) {
    return this.users.update(id, dto, req.user!, clientInfo(req));
  }

  @Post(':id/reset-password')
  @RequirePermission('users:manage')
  @HttpCode(200)
  resetPassword(@Param('id') id: string, @Req() req: AppRequest) {
    return this.users.resetPassword(id, req.user!, clientInfo(req));
  }

  @Post(':id/reset-mfa')
  @RequirePermission('users:manage')
  @HttpCode(204)
  async resetMfa(@Param('id') id: string, @Req() req: AppRequest) {
    await this.users.resetMfa(id, req.user!, clientInfo(req));
  }
}
