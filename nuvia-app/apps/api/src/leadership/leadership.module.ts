import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { FinanceService } from './finance.service';
import { GoalsService } from './goals.service';
import { HealthService } from './health.service';
import { LeadershipController } from './leadership.controller';

@Module({
  controllers: [LeadershipController],
  providers: [HealthService, AlertsService, FinanceService, GoalsService],
})
export class LeadershipModule {}
