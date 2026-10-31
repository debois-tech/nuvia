import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, TotpService],
  exports: [AuthService, SessionService, TotpService],
})
export class AuthModule {}
