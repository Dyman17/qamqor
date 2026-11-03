import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller()
export class AppController {
  @Get()
  getRoot(@Res() res: Response) {
    return res.json({
      status: 'online',
      service: 'Qamqor Ingestion & REST API',
      version: '1.2.0',
      telemetryEndpoint: 'POST /api/v1/device/telemetry',
      dashboard: 'https://qamqor-web.onrender.com',
    });
  }

  @Get('health')
  getHealth() {
    return { status: 'healthy', timestamp: new Date().toISOString() };
  }
}
