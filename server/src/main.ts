import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadAppConfig } from './config/config';
import { configureApp } from './bootstrap';
import { defaultSiteDistDir, mountSite } from './config/site';

async function bootstrap() {
  const logger = new Logger('QamqorBootstrap');
  // Environment is validated by ConfigModule (see AppModule) before this point.
  const cfg = loadAppConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app, cfg);
  mountSite(app, process.env.SITE_DIST_DIR || defaultSiteDistDir());

  await app.listen(cfg.port, '0.0.0.0');
  logger.log(`Qamqor API listening on 0.0.0.0:${cfg.port}`);
}

bootstrap();
