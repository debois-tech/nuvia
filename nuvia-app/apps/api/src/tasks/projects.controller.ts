import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { AuthedRequest, Roles } from '../auth/roles';
import { parse } from '../common/zod';
import { ProjectsService } from './projects.service';
import { AddMemberBody, CreateProjectBody, UpdateProjectBody } from './schemas';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query('archived') archived?: string) {
    return this.projects.list(req.user, archived === '1' || archived === 'true');
  }

  @Post()
  @Roles('team_lead', 'hr_admin')
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.projects.create(req.user, parse(CreateProjectBody, body));
  }

  // Declared before ':id' so it is not read as an id.
  @Get('directory')
  @Roles('team_lead', 'hr_admin')
  directory() {
    return this.projects.directory();
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(req.user, id);
  }

  @Patch(':id')
  update(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.projects.update(req.user, id, parse(UpdateProjectBody, body));
  }

  @Post(':id/members')
  addMember(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.projects.addMember(req.user, id, parse(AddMemberBody, body));
  }

  @Delete(':id/members/:userId')
  removeMember(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.projects.removeMember(req.user, id, userId);
  }
}
