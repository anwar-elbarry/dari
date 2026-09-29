import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
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
  // Nothing under /api is ever cached, and the public guest routes are never indexed. This runs before the guards, so
  // even a 429 from the rate limiter or a 403 from the CSRF check carries the headers.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/checkin')) res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter(config.NODE_ENV === 'development'));
  app.enableShutdownHooks();
  return app;
}
