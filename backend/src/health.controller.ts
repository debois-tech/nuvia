import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from './db/db.service';
import { Public } from './rbac/decorators';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  async health() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('database unavailable');
    }
    return { status: 'ok' };
  }
}
