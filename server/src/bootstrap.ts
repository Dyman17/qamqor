import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppConfig } from './config/config';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { securityHeaders } from './config/security-headers';

/**
 * Global HTTP setup shared by main.ts and the HTTP tests. The app must be created with
 * `{ bodyParser: false }` so the body size limit below applies.
 * Order matters: security headers are applied before any route (including /health and 404s).
 */
export function configureApp(app: NestExpressApplication, cfg: AppConfig): void {
  app.disable('x-powered-by');
  // Real client IP for the rate limiter: trust exactly this many reverse-proxy hops (Render = 1).
  if (cfg.trustProxyHops > 0) app.set('trust proxy', cfg.trustProxyHops);
  new Logger('Bootstrap').log(`trust proxy hops: ${cfg.trustProxyHops}`);

  app.use(securityHeaders(cfg.isProduction));
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });

  app.enableCors({
    origin: cfg.corsOrigins.length ? cfg.corsOrigins : false,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['authorization', 'content-type', 'x-farm-id'],
    exposedHeaders: ['x-next-cursor'],
    credentials: true,
  });

  app.useGlobalFilters(new ApiExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
}
