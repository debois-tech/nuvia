import { Module } from '@nestjs/common';
import { AgentController } from './remote/agent.controller';
import { DeviceAuthGuard } from './remote/device-auth.guard';
import { DevicesController } from './remote/devices.controller';
import { DevicesService } from './remote/devices.service';
import { FlagsService } from './remote/flags.service';
import { SchedulerService } from './remote/scheduler.service';
import { SessionsService } from './remote/sessions.service';
import { OfficeController } from './office/office.controller';
import { OfficeService } from './office/office.service';
import { MeController } from './me/me.controller';
import { MeService } from './me/me.service';
import { ReviewController } from './review/review.controller';
import { ReviewService } from './review/review.service';

@Module({
  controllers: [OfficeController, AgentController, DevicesController, MeController, ReviewController],
  providers: [OfficeService, DevicesService, DeviceAuthGuard, FlagsService, SessionsService, SchedulerService, MeService, ReviewService],
  exports: [SessionsService, SchedulerService],
})
export class AttendanceModule {}
