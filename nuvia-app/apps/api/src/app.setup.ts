import { INestApplication } from '@nestjs/common';
import type { AppConfig } from './config/config';

/** Settings shared by the real server and the tests. */
export function configureApp(app: INestApplication, cfg: AppConfig) {
  // Needed to verify agent signatures over the exact bytes received (see main.ts / createNestApplication rawBody).
  (app as any).set('trust proxy', cfg.trustProxy);
  (app as any).disable('x-powered-by');
}
