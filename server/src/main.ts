import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadAppConfig } from './config/config';
import { securityHeaders } from './config/security-headers';

async function bootstrap() {
  const logger = new Logger('QamqorBootstrap');
  // Environment is validated by ConfigModule (see AppModule) before this point.
  const cfg = loadAppConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
  app.use(securityHeaders(cfg.isProduction));

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

  await app.listen(cfg.port, '0.0.0.0');
  logger.log(`Qamqor API listening on 0.0.0.0:${cfg.port}`);
}

bootstrap();
