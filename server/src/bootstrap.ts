import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppConfig } from './config/config';
import { securityHeaders } from './config/security-headers';

/**
 * Global HTTP setup shared by main.ts and the HTTP tests. The app must be created with
 * `{ bodyParser: false }` so the body size limit below applies.
 * Order matters: security headers are applied before any route (including /health and 404s).
 */
export function configureApp(app: NestExpressApplication, cfg: AppConfig): void {
  app.disable('x-powered-by');
  // Behind Render's proxy: real client IP for the rate limiter.
  if (cfg.isProduction) app.set('trust proxy', 1);

  app.use(securityHeaders(cfg.isProduction));
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });

  app.enableCors({
    origin: cfg.corsOrigins.length ? cfg.corsOrigins : false,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['authorization', 'content-type', 'x-farm-id'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
}
