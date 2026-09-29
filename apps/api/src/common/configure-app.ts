import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfig } from '../config/env';
import { HttpExceptionFilter } from './http-exception.filter';
import { requestIdMiddleware } from './request-id';
import { createValidationPipe } from './validation';

/** Shared by main.ts and the HTTP tests, so tests exercise the real pipeline. */
export function configureApp(app: INestApplication, config: AppConfig) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', config.TRUST_PROXY);
  express.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
