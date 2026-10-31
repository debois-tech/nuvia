import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Response } from 'express';
import { AppRequest, clientInfo } from '../common/request-context';
import { AllowPasswordChange, AllowStages, Public } from '../rbac/decorators';
import { ChangePasswordDto, CodeDto, LoginDto } from './auth.dto';
import { AuthService, SessionGrant } from './auth.service';
import { SessionService } from './session.service';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly sessions: SessionService) {}

  private setCookie(res: Response, grant: SessionGrant) {
    res.cookie(this.sessions.cookieName, grant.token, this.sessions.cookieOptions(grant.maxAgeMs));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const grant = await this.auth.login(dto.orgId.trim(), dto.password, clientInfo(req));
    this.setCookie(res, grant);
    return { stage: grant.stage };
  }

  @AllowStages('pending_mfa')
  @Post('mfa/verify')
  @HttpCode(200)
  async verify(@Body() dto: CodeDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const { grant } = await this.auth.verifyMfa(req.user!, req.session!, dto.code.trim(), clientInfo(req));
    this.setCookie(res, grant);
    return { stage: 'active', user: this.auth.me(req.user!) };
  }

  @AllowStages('pending_enroll')
  @Post('mfa/enroll/start')
  @HttpCode(200)
  enrollStart(@Req() req: AppRequest) {
    return this.auth.enrollStart(req.user!, clientInfo(req));
  }

  @AllowStages('pending_enroll')
  @Post('mfa/enroll/confirm')
  @HttpCode(200)
  async enrollConfirm(@Body() dto: CodeDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const { grant, recoveryCodes } = await this.auth.enrollConfirm(req.user!, req.session!, dto.code.trim(), clientInfo(req));
    this.setCookie(res, grant);
    // Shown exactly once. Only hashes are kept.
    return { stage: 'active', recoveryCodes, user: this.auth.me(req.user!) };
  }

  @AllowStages('pending_password')
  @AllowPasswordChange()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const grant = await this.auth.changePassword(req.user!, req.session!, dto.currentPassword, dto.newPassword, clientInfo(req));
    if (grant) {
      this.setCookie(res, grant);
      return { stage: grant.stage };
    }
    return { stage: 'active' };
  }

  @AllowStages('pending_password', 'pending_mfa', 'pending_enroll')
  @AllowPasswordChange()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.user!, req.session!, clientInfo(req));
    res.clearCookie(this.sessions.cookieName, { path: '/', secure: this.sessions.cookieOptions(0).secure, sameSite: 'strict', httpOnly: true });
  }

  @Get('me')
  @AllowPasswordChange()
  me(@Req() req: AppRequest) {
    return this.auth.me(req.user!);
  }
}
