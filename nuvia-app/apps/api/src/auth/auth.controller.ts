import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../common/zod';
import { AuthService } from './auth.service';
import { AuthedRequest, Public } from './roles';

const LoginBody = z.object({ orgId: z.string().min(1).max(64), password: z.string().min(1).max(256) });

/** Stand-in sign-in (org ID + password). Phase 2 adds MFA, lockout and admin-managed accounts. */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const { orgId, password } = parse(LoginBody, body);
    return this.auth.login(orgId, password);
  }

  @Get('me')
  me(@Req() req: AuthedRequest) {
    return req.user;
  }
}
