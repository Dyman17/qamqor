import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GeofenceService } from '../src/geofences/geofence.service';
import { polygonProblem, polygonAreaHa } from '../src/geofences/polygon';
import { CreateGeofenceInputDto } from '../src/geofences/dto/geofence.dto';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { AnimalsService } from '../src/animals/animals.service';
import { TrackQueryDto } from '../src/animals/dto/animal.dto';

const square = (c: number[][] = [[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]) => ({
  type: 'Polygon',
  coordinates: [c],
});
const geo = new GeofenceService(null as any);
const good = { latitude: 43.65, longitude: 51.157, accuracy: 4 };

describe('geometry is fail-closed', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['empty coordinates', { type: 'Polygon', coordinates: [] }],
    ['ring of 2 points', { type: 'Polygon', coordinates: [[[51.15, 43.645], [51.16, 43.65]]] }],
    ['garbage vertices', { type: 'Polygon', coordinates: [[['a', 'b'], [1], null, []]] }],
  ])('%s -> zone UNKNOWN, never GREEN, no tone', (_n, poly) => {
    const r = geo.evaluateLocation(good, poly as any);
    expect(r.zone).toBe('UNKNOWN');
    expect(r.zone).not.toBe('GREEN');
    expect(r.toneFrequencyHz).toBe(0);
    expect(r.distanceMeters).toBeNull();
    expect(r.reason).not.toBeNull();
  });

  it('isPointInPolygon is never "inside" for a malformed boundary', () => {
    expect(geo.isPointInPolygon(good, null)).toBe(false);
    expect(geo.isPointInPolygon(good, {})).toBe(false);
    expect(geo.isPointInPolygon(good, { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] })).toBe(false);
  });

  it('accuracy > 35 m -> UNKNOWN (LOW_ACCURACY) even for a valid boundary', () => {
    const r = geo.evaluateLocation({ ...good, accuracy: 60 }, square());
    expect(r).toMatchObject({ zone: 'UNKNOWN', isReliable: false, reason: 'LOW_ACCURACY' });
  });

  it('valid boundary and fix keep working (GREEN deep inside)', () => {
    expect(geo.evaluateLocation(good, square())).toMatchObject({ zone: 'GREEN', reason: null });
  });
});

describe('polygon validator', () => {
  it('accepts a proper polygon', () => {
    expect(polygonProblem(square())).toBeNull();
  });
  it.each([
    ['not closed', square([[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655]])],
    ['self-intersecting (bow tie)', square([[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]])],
    ['longitude out of range', square([[181, 0], [182, 0], [182, 1], [181, 1], [181, 0]])],
    ['latitude out of range', square([[0, 91], [1, 91], [1, 92], [0, 92], [0, 91]])],
    ['2 distinct vertices', square([[0, 0], [1, 1], [0, 0], [1, 1], [0, 0]])],
    ['zero area (collinear)', square([[0, 0], [1, 1], [2, 2], [0, 0]])],
    ['repeated vertex', square([[0, 0], [1, 0], [1, 0], [1, 1], [0, 1], [0, 0]])],
    ['wrong type', { type: 'Point', coordinates: [0, 0] }],
    ['hole present', { type: 'Polygon', coordinates: [square().coordinates[0], square().coordinates[0]] }],
  ])('rejects: %s', (_n, poly) => {
    expect(polygonProblem(poly)).not.toBeNull();
  });
  it('rejects more than 500 vertices', () => {
    const ring: number[][] = [];
    for (let i = 0; i < 501; i++) {
      const a = (i / 501) * 2 * Math.PI;
      ring.push([Math.cos(a), Math.sin(a)]);
    }
    ring.push(ring[0]);
    expect(polygonProblem(square(ring))).toMatch(/500/);
  });
  it('DTO rejects an invalid polygon and accepts a valid one', async () => {
    const bad = await validate(plainToInstance(CreateGeofenceInputDto, { name: 'g', polygonJson: square([[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]) }));
    expect(bad).toHaveLength(1);
    const ok = await validate(plainToInstance(CreateGeofenceInputDto, { name: 'g', polygonJson: square() }));
    expect(ok).toHaveLength(0);
  });
  it('area in hectares is plausible (0.015 deg x 0.01 deg at 43.65 N: ~1208 m x 1105 m ~ 133 ha)', () => {
    const ha = polygonAreaHa(square());
    expect(ha).toBeGreaterThan(131);
    expect(ha).toBeLessThan(136);
  });
});

describe('TelemetryService', () => {
  function setup(opts: { animal?: any } = {}) {
    const prisma: any = {
      animal: { update: jest.fn() },
      device: { update: jest.fn() },
      telemetry: { create: jest.fn() },
      deviceCommand: { findFirst: jest.fn(async () => null), updateMany: jest.fn() },
    };
    const alerts: any = {
      triggerGeofenceBreach: jest.fn(),
      resolveGeofenceBreach: jest.fn(),
      triggerGpsLost: jest.fn(),
      resolveGpsLost: jest.fn(),
    };
    const config: any = { get: (_k: string, d: string) => d };
    const svc = new TelemetryService(prisma, new GeofenceService({} as any), alerts, config);
    const animal =
      opts.animal === undefined
        ? { id: 'a1', name: 'A', isOutsideGeofence: false, activeGeofence: { polygonJson: square() } }
        : opts.animal;
    const device: any = { id: 'd1', deviceId: 'QAM-0001', farmId: 'f1', animal };
    return { svc, prisma, alerts, device };
  }
  const dto = (over: any = {}): any => ({
    deviceId: 'QAM-0001',
    timestamp: new Date().toISOString(),
    latitude: 43.65,
    longitude: 51.157,
    accuracy: 5,
    ...over,
  });
  const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();

  it.each([
    ['NaN', 'abc'],
    ['older than 10 min', ago(601)],
    ['more than 2 min in the future', ago(-121)],
  ])('timestamp %s -> 400, nothing written', async (_n, ts) => {
    const { svc, prisma } = setup();
    await expect(svc.processDeviceTelemetry(setup().device, dto({ timestamp: ts }))).rejects.toThrow(BadRequestException);
    expect(prisma.telemetry.create).not.toHaveBeenCalled();
  });

  it('timestamps inside the window are accepted (9 min old, 1 min ahead)', async () => {
    for (const ts of [ago(540), ago(-60)]) {
      const { svc, device } = setup();
      await expect(svc.processDeviceTelemetry(device, dto({ timestamp: ts }))).resolves.toMatchObject({ success: true });
    }
  });

  it('animal without a pen: position and lastSeenAt are stored, zone UNKNOWN, no actuators, no GREEN', async () => {
    const { svc, prisma, device } = setup({ animal: { id: 'a1', name: 'A', isOutsideGeofence: false, activeGeofence: null } });
    const res: any = await svc.processDeviceTelemetry(device, dto());
    expect(prisma.animal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({ lastLatitude: 43.65, lastLongitude: 51.157, lastSeenAt: expect.any(Date) }),
      }),
    );
    expect(res).toMatchObject({ zone: 'UNKNOWN', inFence: null, distanceToBorderMeters: null, sound: false, vibrate: false });
    expect(res.warningMessage).toMatch(/no boundary/i);
    expect(prisma.device.update).toHaveBeenCalled();
    expect(prisma.telemetry.create).toHaveBeenCalled();
  });

  it('collar without an animal still records the ping and answers UNKNOWN', async () => {
    const { svc, prisma, device } = setup({ animal: null });
    const res: any = await svc.processDeviceTelemetry(device, dto());
    expect(res.zone).toBe('UNKNOWN');
    expect(prisma.animal.update).not.toHaveBeenCalled();
    expect(prisma.telemetry.create).toHaveBeenCalled();
  });

  it('unreliable fix: UNKNOWN, GPS_LOST alert, previous outside state kept, no signals', async () => {
    const { svc, prisma, alerts, device } = setup();
    device.animal.isOutsideGeofence = true;
    const res: any = await svc.processDeviceTelemetry(device, dto({ accuracy: 80 }));
    expect(res).toMatchObject({ zone: 'UNKNOWN', sound: false, vibrate: false });
    expect(alerts.triggerGpsLost).toHaveBeenCalled();
    expect(prisma.animal.update.mock.calls[0][0].data.isOutsideGeofence).toBe(true);
  });

  it('a reliable fix closes GPS_LOST', async () => {
    const { svc, alerts, device } = setup();
    await svc.processDeviceTelemetry(device, dto());
    expect(alerts.resolveGpsLost).toHaveBeenCalledWith('a1');
  });

  it('no shock fields, no kV text, in any zone', async () => {
    for (const lat of [43.65, 43.6549, 43.6552, 43.7]) {
      const { svc, device } = setup();
      const res: any = await svc.processDeviceTelemetry(device, dto({ latitude: lat }));
      expect(Object.keys(res).filter((k) => /shock|buzzer/i.test(k))).toEqual([]);
      expect(res.warningMessage).not.toMatch(/кВ|kV|shock/i);
    }
  });
});

describe('alert idempotence under parallel pings', () => {
  it('two simultaneous RED pings yield exactly one ACTIVE GEOFENCE_BREACH', async () => {
    const stored: any[] = [];
    const prisma: any = {
      alert: {
        findFirst: jest.fn(async ({ where }: any) => stored.find((a) => a.dedupeKey === where.dedupeKey && a.status === 'ACTIVE') ?? null),
        create: jest.fn(async ({ data }: any) => {
          await new Promise((r) => setImmediate(r)); // both passed the findFirst check
          if (stored.some((a) => a.dedupeKey === data.dedupeKey && a.status === 'ACTIVE')) {
            throw Object.assign(new Error('unique'), { code: 'P2002' });
          }
          const row = { id: 'x' + stored.length, ...data };
          stored.push(row);
          return row;
        }),
      },
    };
    const svc = new AlertsService(prisma);
    const call = () => svc.triggerGeofenceBreach({ farmId: 'f', animalId: 'a', animalName: 'A', deviceId: 'd', latitude: 1, longitude: 2 });
    const [r1, r2] = await Promise.all([call(), call()]);
    expect(stored).toHaveLength(1);
    expect(r1!.id).toBe(r2!.id);
    expect(stored[0].dedupeKey).toBe('GEOFENCE_BREACH:a');
  });

  it('migration 0007 creates a partial unique index and cleans existing duplicates first', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '0007_alert_dedupe', 'migration.sql'), 'utf8');
    expect(sql).toMatch(/CREATE UNIQUE INDEX "alerts_active_dedupe_key"[\s\S]*WHERE "status" = 'ACTIVE'/);
    expect(sql.indexOf(`SET "status" = 'RESOLVED'`)).toBeLessThan(sql.indexOf('CREATE UNIQUE INDEX'));
    expect(sql.indexOf('SET "dedupeKey"')).toBeLessThan(sql.indexOf('CREATE UNIQUE INDEX'));
  });
});

describe('GET /animals/:id/track query', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const meta = { type: 'query' as const, metatype: TrackQueryDto };

  it('limit above 500 or non-numeric -> 400; valid limit is converted to a number', async () => {
    await expect(pipe.transform({ limit: '999999' }, meta)).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ limit: 'abc' }, meta)).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ limit: '0' }, meta)).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ limit: '1.5' }, meta)).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ limit: '500' }, meta)).resolves.toMatchObject({ limit: 500 });
  });
  it('from/to must be ISO dates', async () => {
    await expect(pipe.transform({ from: 'yesterday' }, meta)).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ from: '2026-11-01T00:00:00Z', to: '2026-11-08T00:00:00Z' }, meta)).resolves.toBeDefined();
  });

  it('service returns the latest N points, oldest first, in contract shape', async () => {
    const t = (n: number) => new Date(Date.UTC(2026, 10, 8, 0, n));
    const prisma: any = {
      animal: { findFirst: jest.fn(async () => ({ id: 'a', name: 'A', tagNumber: 'T' })) },
      telemetry: {
        findMany: jest.fn(async () => [
          { latitude: 2, longitude: 2, accuracy: 3, isOutsideGeofence: true, timestamp: t(2) },
          { latitude: 1, longitude: 1, accuracy: 3, isOutsideGeofence: false, timestamp: t(1) },
        ]),
      },
    };
    const res = await new AnimalsService(prisma).getAnimalTrack('u', 'f', 'a', { limit: 2 });
    expect(prisma.telemetry.findMany.mock.calls[0][0]).toMatchObject({ orderBy: { timestamp: 'desc' }, take: 2 });
    expect(res.points.map((p) => p.lat)).toEqual([1, 2]);
    expect(res.points[1]).toEqual({ lat: 2, lng: 2, accuracyM: 3, at: t(2).toISOString(), isOutside: true });
    expect(res.animal).toEqual({ id: 'a', name: 'A', tag: 'T' });
  });
});
