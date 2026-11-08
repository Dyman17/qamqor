import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadAppConfig } from './config/config';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const logger = new Logger('QamqorBootstrap');
  // Environment is validated by ConfigModule (see AppModule) before this point.
  const cfg = loadAppConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app, cfg);

  await app.listen(cfg.port, '0.0.0.0');
  logger.log(`Qamqor API listening on 0.0.0.0:${cfg.port}`);
}

bootstrap();
