import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './config/config';
import { runMigrations } from './db/migrate';
import { Pool } from 'pg';

async function bootstrap() {
  const cfg = loadConfig();
  const pool = new Pool({ connectionString: cfg.databaseUrl });
  await runMigrations(pool, console.log).finally(() => pool.end());

  const app = await NestFactory.create(AppModule.register(cfg), { rawBody: true });
  configureApp(app, cfg);
  // Bind to the address given in HOST. In production this is the WireGuard interface, never 0.0.0.0.
  await app.listen(cfg.port, process.env.HOST ?? '127.0.0.1');
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
