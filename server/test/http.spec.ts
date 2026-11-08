import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppController } from '../src/app.controller';
import { TelemetryController } from '../src/telemetry/telemetry.controller';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { DeviceAuthGuard } from '../src/devices/device-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/bootstrap';
import { loadAppConfig } from '../src/config/config';
import { hashDeviceSecret } from '../src/devices/device-secret';

const SECRET = 'a'.repeat(64);
const device = { id: 'd1', deviceId: 'QAM-0001', secretHash: hashDeviceSecret(SECRET), farm: null, animal: null };

const fakePrisma = {
  device: {
    findUnique: jest.fn(async ({ where }: any) => (where.secretHash === device.secretHash ? device : null)),
  },
};
const telemetry = { processDeviceTelemetry: jest.fn(async () => ({ success: true })) };

@Module({
  controllers: [AppController, TelemetryController],
  providers: [
    { provide: PrismaService, useValue: fakePrisma },
    { provide: TelemetryService, useValue: telemetry },
    DeviceAuthGuard,
  ],
})
class TestModule {}

describe('HTTP layer (real Nest app, production config, fake database)', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestModule, { bodyParser: false, logger: false });
    configureApp(app, loadAppConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://ok.example' }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const ping = {
    deviceId: 'QAM-0001',
    timestamp: new Date().toISOString(),
    latitude: 43.65,
    longitude: 51.157,
    accuracy: 5,
  };
  const post = (body: any, token?: string) =>
    fetch(`${base}/api/v1/device/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it('GET /health carries security headers and no X-Powered-By', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('strict-transport-security')).toContain('max-age');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('unknown routes also carry the headers', async () => {
    const r = await fetch(`${base}/nope`);
    expect(r.status).toBe(404);
    expect(((await r.json()) as any).code).toBe('NOT_FOUND');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('GET / does not advertise an unverified dashboard URL', async () => {
    const body: any = await (await fetch(`${base}/`)).json();
    expect(body).not.toHaveProperty('dashboard');
    expect(JSON.stringify(body)).not.toMatch(/onrender\.com/);
  });

  it('CORS: foreign origin gets no allow-origin header, configured origin does', async () => {
    const evil = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await fetch(`${base}/health`, { headers: { origin: 'https://ok.example' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://ok.example');
  });

  it('telemetry: no credentials + invalid body -> 401 (authentication precedes validation, no schema leak)', async () => {
    const r = await post({ junk: true });
    expect(r.status).toBe(401);
    const body: any = await r.json();
    expect(body).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Invalid device credentials' });
    expect(JSON.stringify(body)).not.toMatch(/latitude|timestamp|must be|should not exist/i);
    expect(telemetry.processDeviceTelemetry).not.toHaveBeenCalled();
  });

  it('telemetry: unknown or wrong secret + invalid body -> the same 401', async () => {
    const a = await post({}, 'f'.repeat(64));
    const b = await post({ deviceId: 'x' }, 'short');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });

  it('telemetry: valid secret + invalid body -> 400 with validation errors', async () => {
    const r = await post({ deviceId: 'QAM-0001', timestamp: 'abc' }, SECRET);
    expect(r.status).toBe(400);
    expect(telemetry.processDeviceTelemetry).not.toHaveBeenCalled();
  });

  it('telemetry: another device id in the body with a valid secret -> 401', async () => {
    const r = await post({ ...ping, deviceId: 'QAM-0002' }, SECRET);
    expect(r.status).toBe(401);
  });

  it('telemetry: valid secret + valid body -> 200', async () => {
    const r = await post(ping, SECRET);
    expect(r.status).toBe(200);
    expect(telemetry.processDeviceTelemetry).toHaveBeenCalledTimes(1);
  });

  it('telemetry: unknown extra field -> 400', async () => {
    const r = await post({ ...ping, extra: 80 }, SECRET);
    expect(r.status).toBe(400);
  });

  it('telemetry: timestamp must be a real ISO date with a zone', async () => {
    for (const ts of ['abc', '2026-13-45T00:00:00Z', '2026-11-08 10:00:00Z', '2026-11-08T10:00:00']) {
      const r = await post({ ...ping, timestamp: ts }, SECRET);
      expect(r.status).toBe(400);
    }
  });
});
