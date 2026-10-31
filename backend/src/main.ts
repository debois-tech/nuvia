import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import { configureApp } from './setup';

async function bootstrap() {
  const config = loadConfig(); // fails fast on a bad configuration
  const app = await NestFactory.create(AppModule);
  configureApp(app, config);
  app.enableShutdownHooks();
  // BIND_ADDR is the WireGuard address on the VM (or 127.0.0.1 behind the proxy), never 0.0.0.0.
  await app.listen(config.port, config.bindAddr);
  new Logger('Nuvia').log(`API listening on ${config.bindAddr}:${config.port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
