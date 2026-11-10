import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TelemetryController } from '../src/telemetry/telemetry.controller';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { LiveViewersService, MAX_STREAMS_PER_USER } from '../src/telemetry/live-viewers.service';
import { GeofenceService } from '../src/geofences/geofence.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { FarmAccessGuard } from '../src/farms/farm-access.guard';
import { RateLimitGuard, RateLimiterService } from '../src/common/rate-limit';
import { DeviceAuthGuard } from '../src/devices/device-auth.guard';
import { configureApp } from '../src/bootstrap';
import { loadAppConfig } from '../src/config/config';

const SECRET = 'x'.repeat(48);
const DEVICES = [
  { id: 'd1', deviceId: 'QAM-11111111', code: '11111111', farmId: 'f1', signal: -71, lastHeartbeatAt: new Date(), animal: null },
  { id: 'd2', deviceId: 'QAM-22222222', code: '22222222', farmId: 'f2', signal: -60, lastHeartbeatAt: new Date(), animal: null },
];
const fakePrisma: any = {
  user: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, email: `${where.id}@x.kz`, fullName: where.id, passwordChangedAt: null })) },
  farmMember: {
    findUnique: jest.fn(async ({ where }: any) => {
      const { userId, farmId } = where.userId_farmId;
      const ok = (userId === 'u1' && farmId === 'f1') || (userId === 'u2' && farmId === 'f2');
      return ok ? { farmId, role: 'OWNER', farm: { workerCanEditBoundaries: false } } : null;
    }),
    findMany: jest.fn(async () => []),
  },
  device: {
    findFirst: jest.fn(async ({ where }: any) => DEVICES.find((d) => d.code === where.code && d.farmId === where.farmId) ?? null),
    findUnique: jest.fn(async () => null),
    count: jest.fn(async () => 0),
  },
  telemetry: { findMany: jest.fn(async () => []) },
};

const live = new LiveViewersService();
const telemetry = new TelemetryService(
  fakePrisma,
  new GeofenceService({} as any),
  {} as any,
  { get: (_k: string, d: string) => d } as any,
  {} as any,
  live,
);

@Module({
  imports: [PassportModule, JwtModule.register({ secret: SECRET })],
  controllers: [TelemetryController],
  providers: [
    { provide: PrismaService, useValue: fakePrisma },
    { provide: ConfigService, useValue: { getOrThrow: () => SECRET, get: (_k: string, d: any) => d } },
    { provide: TelemetryService, useValue: telemetry },
    JwtStrategy,
    FarmAccessGuard,
    RateLimiterService,
    RateLimitGuard,
    DeviceAuthGuard,
  ],
})
class TestModule {}

describe('GET /device/telemetry and /device/stream are authenticated and farm-scoped', () => {
  let app: NestExpressApplication;
  let base: string;
  let token1: string;
  let token2: string;
  const aborts: AbortController[] = [];

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestModule, { bodyParser: false, logger: false });
    configureApp(app, loadAppConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://ok.example' }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const jwt = app.get(JwtService);
    token1 = jwt.sign({ sub: 'u1', email: 'u1@x.kz' });
    token2 = jwt.sign({ sub: 'u2', email: 'u2@x.kz' });
  });
  afterAll(async () => {
    aborts.forEach((a) => a.abort());
    await app.close();
  });

  const auth = (token: string, farm: string) => ({ authorization: `Bearer ${token}`, 'x-farm-id': farm });
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}/api/v1/device/${path}`, { headers });

  it('no credentials -> 401 JSON on both endpoints', async () => {
    for (const path of ['telemetry?code=11111111', 'telemetry', 'stream']) {
      const r = await get(path, { accept: 'text/event-stream' });
      expect(r.status).toBe(401);
      expect(r.headers.get('content-type')).toMatch(/application\/json/);
      expect(((await r.json()) as any).code).toBe('UNAUTHENTICATED');
    }
  });

  it('a foreign farm id -> 403 JSON before the stream starts', async () => {
    const t = await get('telemetry?code=11111111', auth(token1, 'f2'));
    expect(t.status).toBe(403);
    const s = await get('stream', { ...auth(token1, 'f2'), accept: 'text/event-stream' });
    expect(s.status).toBe(403);
    expect(s.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('telemetry: code is required and must be 8 digits (400)', async () => {
    for (const q of ['', '?code=1234', '?code=abcdefgh', '?code=123456789']) {
      expect((await get(`telemetry${q}`, auth(token1, 'f1'))).status).toBe(400);
    }
  });

  it('telemetry: own device 200 (with signalRssi from device.signal), other farm 404, unknown 404', async () => {
    const ok = await get('telemetry?code=11111111', auth(token1, 'f1'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, code: '11111111', signalRssi: -71 });
    const foreign = await get('telemetry?code=22222222', auth(token1, 'f1'));
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(await foreign.json())).not.toMatch(/-60|22222222/);
    expect((await get('telemetry?code=99999999', auth(token1, 'f1'))).status).toBe(404);
  });

  async function openStream(token: string, farm: string, query = '') {
    const ac = new AbortController();
    aborts.push(ac);
    const res = await fetch(`${base}/api/v1/device/stream${query}`, {
      headers: { ...auth(token, farm), accept: 'text/event-stream' },
      signal: ac.signal,
    });
    return { res, ac };
  }
  async function readUntil(res: Response, re: RegExp, ms = 3000): Promise<string> {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const end = Date.now() + ms;
    while (Date.now() < end && !re.test(buf)) {
      const r = await Promise.race([reader.read(), new Promise<any>((x) => setTimeout(() => x({ timeout: true }), 200))]);
      if (r.timeout) continue;
      if (r.done) break;
      buf += dec.decode(r.value);
    }
    reader.releaseLock();
    return buf;
  }
  const event = (deviceId: string, farmId: string | null) => ({
    farmId, deviceId, code: deviceId.slice(4), animalId: null, heartRate: null, lastHeartRateAt: null, pulseThreat: null,
    latitude: 1, longitude: 2, accuracyM: 5, zone: 'GREEN', inFence: true, distanceToBorderMeters: 10, sound: false,
    vibrate: false, lastSeenAt: new Date().toISOString(), serverTime: new Date().toISOString(), rssi: null,
  });

  it('stream: headers, farm filtering, live viewer accounting', async () => {
    expect(live.viewerCount('f1')).toBe(0);
    const { res, ac } = await openStream(token1, 'f1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/no-cache/);
    expect(cc).toMatch(/no-transform/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(live.viewerCount('f1')).toBe(1);

    const subject = (telemetry as any).telemetryEvents$;
    subject.next(event('QAM-22222222', 'f2'));
    subject.next(event('QAM-33333333', null));
    subject.next(event('QAM-11111111', 'f1'));
    const text = await readUntil(res, /QAM-11111111/);
    expect(text).toContain('"type":"keepalive"');
    expect(text).toContain('QAM-11111111');
    expect(text).not.toContain('QAM-22222222');
    expect(text).not.toContain('QAM-33333333');
    expect(text).not.toContain('"farmId"');

    ac.abort();
    for (let i = 0; i < 20 && live.viewerCount('f1') > 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(live.viewerCount('f1')).toBe(0);
    expect(live.isLive('f1', 120)).toBe(true);
    expect(live.userStreams('u1')).toBe(0);
  });

  it('stream: the optional animalId / code filters still work', async () => {
    const { res, ac } = await openStream(token2, 'f2', '?code=22222222');
    const subject = (telemetry as any).telemetryEvents$;
    subject.next({ ...event('QAM-44444444', 'f2'), code: '44444444' });
    subject.next(event('QAM-22222222', 'f2'));
    const text = await readUntil(res, /QAM-22222222/);
    expect(text).toContain('QAM-22222222');
    expect(text).not.toContain('QAM-44444444');
    ac.abort();
  });

  it('stream: more than the per-user cap is 429 JSON', async () => {
    const open = [];
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) open.push(await openStream(token2, 'f2'));
    expect(open.every((o) => o.res.status === 200)).toBe(true);
    const extra = await fetch(`${base}/api/v1/device/stream`, { headers: { ...auth(token2, 'f2'), accept: 'text/event-stream' } });
    expect(extra.status).toBe(429);
    expect(extra.headers.get('content-type')).toMatch(/application\/json/);
    open.forEach((o) => o.ac.abort());
    for (let i = 0; i < 20 && live.userStreams('u2') > 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(live.userStreams('u2')).toBe(0);
  });
});
