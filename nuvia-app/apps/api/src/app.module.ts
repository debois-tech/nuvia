import { DynamicModule, Global, Module } from '@nestjs/common';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditService } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { Clock } from './common/clock';
import { DbService } from './common/db.service';
import { RandomSource } from './common/random';
import { APP_CONFIG, AppConfig, loadConfig } from './config/config';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { TasksModule } from './tasks/tasks.module';

@Global()
@Module({
  providers: [DbService, Clock, RandomSource, AuditService, NotificationsService],
  exports: [DbService, Clock, RandomSource, AuditService, NotificationsService, APP_CONFIG],
})
class CoreModule {
  static forConfig(cfg: AppConfig): DynamicModule {
    return { module: CoreModule, providers: [{ provide: APP_CONFIG, useValue: cfg }] };
  }
}

@Module({})
export class AppModule {
  static register(cfg: AppConfig = loadConfig()): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forConfig(cfg), AuthModule, AttendanceModule, TasksModule],
      controllers: [NotificationsController],
    };
  }
}
