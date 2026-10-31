import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuditViewInterceptor } from './audit/audit-view.interceptor';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { AppConfig, CONFIG } from './config/config';
import { ConfigModule } from './config/config.module';
import { CryptoModule } from './crypto/crypto.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { PermissionsGuard } from './rbac/permissions.guard';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => ({ throttlers: [{ ttl: 60_000, limit: cfg.authRateLimit }] }),
    }),
    DbModule,
    CryptoModule,
    AuditModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: sign-in check first, then the role/permission check.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditViewInterceptor },
  ],
})
export class AppModule {}
