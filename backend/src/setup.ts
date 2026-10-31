import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfig } from './config/config';

/** Shared by main.ts and the end-to-end tests so tests run with the real middleware. */
export function configureApp(app: INestApplication, config: AppConfig) {
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', config.trustProxy);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: false }));
}
