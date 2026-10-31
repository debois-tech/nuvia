import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { SessionsService } from './sessions.service';

/** Runs idle detection, prompt expiry, random checks and data retention on a timer. */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('AttendanceScheduler');
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastPurge = 0;

  constructor(private readonly sessions: SessionsService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  onApplicationBootstrap() {
    if (!this.cfg.schedulerEnabled) return;
    this.timer = setInterval(() => void this.run(), this.cfg.schedulerIntervalSeconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.sessions.tick();
      if (Date.now() - this.lastPurge > 6 * 3_600_000) {
        this.lastPurge = Date.now();
        const n = await this.sessions.purgeOldHeartbeats();
        if (n) this.log.log(`purged ${n} heartbeat rows past retention`);
      }
    } catch (err) {
      this.log.error(`tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
