import { Body, Controller, UnsupportedMediaTypeException, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { AuthedRequest } from '../auth/roles';
import { parse } from '../common/zod';
import { AttachmentsService } from './attachments.service';
import { CommentBody, CreateTaskBody, ListTasksQuery, UpdateTaskBody } from './schemas';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService, private readonly files: AttachmentsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.tasks.list(req.user, parse(ListTasksQuery, query));
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.tasks.create(req.user, parse(CreateTaskBody, body));
  }

  // Static 'attachments' routes come before ':id' ones.
  @Get('attachments/:attId')
  async download(@Req() req: AuthedRequest, @Param('attId', ParseUUIDPipe) attId: string, @Res() res: Response) {
    const f = await this.files.open(req.user, attId);
    // Always a download, never rendered by the browser, so an uploaded HTML or SVG file can't run script here.
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.attachment(f.name);
    await pipeline(f.stream, res).catch(() => res.destroy());
  }

  @Delete('attachments/:attId')
  @HttpCode(204)
  async removeAttachment(@Req() req: AuthedRequest, @Param('attId', ParseUUIDPipe) attId: string) {
    await this.files.remove(req.user, attId);
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(req.user, id);
  }

  @Patch(':id')
  update(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tasks.update(req.user, id, parse(UpdateTaskBody, body));
  }

  @Post(':id/comments')
  comment(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tasks.comment(req.user, id, parse(CommentBody, body));
  }

  /**
   * The file is the raw request body, sent as application/octet-stream (so no body parser reads it). The file's own
   * name and type go in `?name=` and `?type=`.
   */
  @Post(':id/attachments')
  upload(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Query('name') name?: string, @Query('type') type?: string) {
    if (!/^application\/octet-stream\b/i.test(req.headers['content-type'] ?? '')) {
      req.resume();
      throw new UnsupportedMediaTypeException('Send the file as application/octet-stream');
    }
    const len = req.headers['content-length'];
    return this.files.upload(req.user, id, req, { name, type, length: len === undefined ? null : Number(len) });
  }
}
