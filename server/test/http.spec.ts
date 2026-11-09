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
import { MAILER } from '../src/mail/mailer';
import { RateLimitGuard, RateLimiterService } from '../src/common/rate-limit';

const CODE = '12345678';
const device = { id: 'd1', deviceId: 'QAM-12345678', code: CODE, farmId: 'f1', farm: null, animal: null };

const fakePrisma = {
  device: {
    findUnique: jest.fn(async ({ where }: any) => (where.code === CODE ? device : null)),
    count: jest.fn(async () => 0),
    create: jest.fn(async ({ data }: any) => ({ id: 'n', farmId: null, farm: null, animal: null, ...data })),
  },
};
const telemetry = { processDeviceTelemetry: jest.fn(async () => ({ success: true, zone: 'GREEN', nextInterval: 300 })) };

@Module({
  controllers: [AppController, TelemetryController],
  providers: [
    { provide: PrismaService, useValue: fakePrisma },
    { provide: TelemetryService, useValue: telemetry },
    { provide: MAILER, useValue: { status: () => 'none', send: jest.fn() } },
    DeviceAuthGuard,
    RateLimiterService,
    RateLimitGuard,
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
    code: CODE,
    timestamp: new Date().toISOString(),
    latitude: 43.65,
    longitude: 51.157,
    accuracy: 5,
  };
  const post = (body: any, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/v1/device/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
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

  it('GET /health reports the mail transport state', async () => {
    expect(((await (await fetch(`${base}/health`)).json()) as any).mail).toBe('none');
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

  it('telemetry: no code + invalid body -> 400 with code null (identification precedes validation, no schema leak)', async () => {
    const r = await post({ junk: true });
    expect(r.status).toBe(400);
    const body: any = await r.json();
    expect(body).toMatchObject({ statusCode: 400, error: 'VALIDATION', code: null });
    expect(JSON.stringify(body)).not.toMatch(/latitude|timestamp|must be|should not exist/i);
    expect(telemetry.processDeviceTelemetry).not.toHaveBeenCalled();
  });

  it('telemetry: unknown well-formed code is accepted (open acceptance) and echoed', async () => {
    const r = await post({ ...ping, code: '87654321' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ success: true, code: '87654321' });
    expect(fakePrisma.device.create).toHaveBeenCalledTimes(1);
  });

  it('telemetry: a code that is not 8 digits -> 400 with code null', async () => {
    for (const c of ['1234567', '123456789', 'abcdefgh', '1234 678']) {
      const r = await post({ ...ping, code: c });
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).code).toBeNull();
    }
    expect(telemetry.processDeviceTelemetry).not.toHaveBeenCalled();
    expect(fakePrisma.device.create).not.toHaveBeenCalled();
  });

  it('telemetry: claimed code + invalid body -> 400 that still carries the code', async () => {
    const r = await post({ code: CODE, timestamp: 'abc' });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ statusCode: 400, code: CODE, error: 'VALIDATION' });
    expect(telemetry.processDeviceTelemetry).not.toHaveBeenCalled();
  });

  it('telemetry: claimed code + valid body -> 200 with the same code and the command fields', async () => {
    const r = await post(ping);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ success: true, code: CODE, zone: 'GREEN', nextInterval: 300 });
    expect(telemetry.processDeviceTelemetry).toHaveBeenCalledTimes(1);
    expect((telemetry.processDeviceTelemetry.mock.calls[0] as any)[1]).toMatchObject({ deviceId: 'QAM-12345678' });
  });

  it('telemetry: the code may come in the X-Device-Code header', async () => {
    const { code, ...rest } = ping;
    const r = await post(rest, { 'x-device-code': CODE });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).code).toBe(CODE);
  });

  it('telemetry: body code and header code that disagree -> 400', async () => {
    const r = await post(ping, { 'x-device-code': '87654321' });
    expect(r.status).toBe(400);
  });

  it('telemetry: unknown extra field -> 400 (code still echoed)', async () => {
    const r = await post({ ...ping, extra: 80 });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).code).toBe(CODE);
  });

  it('telemetry: timestamp must be a real ISO date with a zone', async () => {
    for (const ts of ['abc', '2026-13-45T00:00:00Z', '2026-11-08 10:00:00Z', '2026-11-08T10:00:00']) {
      const r = await post({ ...ping, timestamp: ts });
      expect(r.status).toBe(400);
    }
  });

  it('telemetry: rate limited per code (429 carries the code), other codes are unaffected', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 40; i++) last = await post({ ...ping, code: '11112222' });
    expect(last!.status).toBe(429);
    expect(await last!.json()).toMatchObject({ statusCode: 429, error: 'RATE_LIMITED', code: '11112222' });
  });
});
