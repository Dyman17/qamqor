import { Controller, Get, Inject } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { MAILER, Mailer } from './mail/mailer';

function readVersion(): string {
  try {
    // server/package.json is one level above both src/ and dist/
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
const PACKAGE_VERSION = readVersion();

@Controller()
export class AppController {
  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  @Get('api/info')
  getInfo() {
    return {
      status: 'online',
      service: 'Qamqor Ingestion & REST API',
      version: PACKAGE_VERSION,
      telemetryEndpoint: 'POST /api/v1/device/telemetry',
    };
  }

  @Get('health')
  getHealth() {
    return { status: 'healthy', timestamp: new Date().toISOString(), mail: this.mailer.status() };
  }
}
