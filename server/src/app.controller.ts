import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
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
    return { status: 'healthy', timestamp: new Date().toISOString() };
  }
}
