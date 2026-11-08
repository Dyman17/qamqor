import { Controller, Get, Inject } from '@nestjs/common';
import { MAILER, Mailer } from './mail/mailer';

@Controller()
export class AppController {
  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  @Get()
  getRoot() {
    return {
      status: 'online',
      service: 'Qamqor Ingestion & REST API',
      version: '1.2.0',
      telemetryEndpoint: 'POST /api/v1/device/telemetry',
    };
  }

  @Get('health')
  getHealth() {
    return { status: 'healthy', timestamp: new Date().toISOString(), mail: this.mailer.status() };
  }
}
