import * as fs from 'fs';
import * as path from 'path';
import { ValidationPipe } from '@nestjs/common';
import { DeviceTelemetryDto } from '../src/telemetry/dto/device-telemetry.dto';
import { AlertsService } from '../src/alerts/alerts.service';
import { AnalyticsService } from '../src/analytics/analytics.service';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const meta = { type: 'body' as const, metatype: DeviceTelemetryDto };
const ping = () => ({
  deviceId: 'QAM-0001',
  timestamp: new Date().toISOString(),
  latitude: 43.65,
  longitude: 51.157,
  accuracy: 5,
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|prisma)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('battery is removed everywhere', () => {
  it('telemetry without battery is valid', async () => {
    await expect(pipe.transform(ping(), meta)).resolves.toMatchObject({ deviceId: 'QAM-0001' });
  });

  it('telemetry with an extra battery field is rejected (400)', async () => {
    await expect(pipe.transform({ ...ping(), battery: 80 }, meta)).rejects.toMatchObject({ status: 400 });
  });

  it('no source, schema, seed or test mentions battery (migrations are exempt)', () => {
    const root = path.join(__dirname, '..');
    const files = [
      ...walk(path.join(root, 'src')),
      ...walk(path.join(root, 'test')).filter((f) => !f.endsWith('battery-removed.spec.ts')),
      path.join(root, 'prisma', 'schema.prisma'),
      path.join(root, 'prisma', 'seed.ts'),
    ];
    const offenders = files.filter((f) => /battery/i.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('alert stats and analytics overview have no battery counters', async () => {
    const prisma: any = {
      alert: { count: jest.fn(async () => 2), findMany: jest.fn(async () => []) },
      animal: { count: jest.fn(async () => 3), groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
      device: { count: jest.fn(async () => 1) },
    };
    const stats = await new AlertsService(prisma).getAlertStats('u', 'f');
    expect(Object.keys(stats).sort()).toEqual(['activeBreaches', 'activeTotal', 'offline']);
    const overview: any = await new AnalyticsService(prisma).getOverview('u', 'f');
    expect(Object.keys(overview.stats)).not.toContain('lowBatteryDevices');
  });

  it('migration 0006 converts LOW_BATTERY rows before the enums are recreated', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '0006_drop_battery', 'migration.sql'), 'utf8');
    const fixAlerts = sql.indexOf(`DELETE FROM "alerts" WHERE "type"::text = 'LOW_BATTERY'`);
    const fixDevices = sql.indexOf(`UPDATE "devices" SET "status" = 'ONLINE' WHERE "status"::text = 'LOW_BATTERY'`);
    const firstEnum = sql.indexOf('CREATE TYPE');
    expect(fixAlerts).toBeGreaterThanOrEqual(0);
    expect(fixDevices).toBeGreaterThanOrEqual(0);
    expect(fixAlerts).toBeLessThan(firstEnum);
    expect(fixDevices).toBeLessThan(firstEnum);
  });
});
