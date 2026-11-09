import 'reflect-metadata';
import { ValidationPipe, ConflictException, NotFoundException, BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { AppController } from '../src/app.controller';
import { AuthController } from '../src/auth/auth.controller';
import { FarmsController } from '../src/farms/farms.controller';
import { AnimalsController } from '../src/animals/animals.controller';
import { GeofenceController } from '../src/geofences/geofence.controller';
import { DevicesController } from '../src/devices/devices.controller';
import { AlertsController } from '../src/alerts/alerts.controller';
import { AnalyticsController } from '../src/analytics/analytics.controller';
import { TelemetryController } from '../src/telemetry/telemetry.controller';
import { SimulationController } from '../src/simulation/simulation.controller';
import { toAnimalDto, animalStatus } from '../src/animals/mappers';
import { toAlertDto } from '../src/alerts/mappers';
import { toCollarDto } from '../src/devices/devices.service';
import { toPenDto } from '../src/geofences/geofence.service';
import { toFarmDto } from '../src/farms/farms.service';
import { AnimalsService } from '../src/animals/animals.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { GeofenceService } from '../src/geofences/geofence.service';
import { CreateAnimalInputDto, SteerDto, ListAnimalsQueryDto } from '../src/animals/dto/animal.dto';
import { CreateGeofenceInputDto } from '../src/geofences/dto/geofence.dto';
import { pageOf } from '../src/common/pagination';
import { toErrorBody } from '../src/common/api-exception.filter';
import { forbiddenFarm, forbiddenRole } from '../src/common/errors';
import { routesOf } from './helpers/routes';

const V = '/api/v1';
const EXPECTED_ROUTES = [
  'GET /api/info', 'GET /health',
  `POST ${V}/auth/register`, `POST ${V}/auth/login`, `GET ${V}/auth/me`,
  `POST ${V}/auth/password-reset/request`, `POST ${V}/auth/password-reset/confirm`, `POST ${V}/auth/invitations/accept`,
  `GET ${V}/farms`, `POST ${V}/farms`, `GET ${V}/farms/:id`, `PATCH ${V}/farms/:id`,
  `GET ${V}/farms/:id/members`, `DELETE ${V}/farms/:id/members/:userId`,
  `POST ${V}/farms/:id/invitations`, `DELETE ${V}/farms/:id/invitations/:invId`,
  `GET ${V}/farms/:id/signal-limits`, `PUT ${V}/farms/:id/signal-limits`,
  `GET ${V}/animals`, `POST ${V}/animals`, `POST ${V}/animals/steer`, `GET ${V}/animals/:id`,
  `GET ${V}/animals/:id/signals`, `GET ${V}/animals/:id/events`, `GET ${V}/animals/:id/track`,
  `POST ${V}/animals/:id/assign-collar`, `POST ${V}/animals/:id/unassign-collar`,
  `PATCH ${V}/animals/:id`, `DELETE ${V}/animals/:id`,
  `GET ${V}/geofences`, `GET ${V}/geofences/:id`, `POST ${V}/geofences`, `PATCH ${V}/geofences/:id`, `DELETE ${V}/geofences/:id`,
  `GET ${V}/devices`, `GET ${V}/devices/:id`, `POST ${V}/devices`, `PATCH ${V}/devices/:id`,
  `POST ${V}/devices/:id/rotate-secret`, `POST ${V}/devices/:id/test-signal`, `DELETE ${V}/devices/:id`,
  `GET ${V}/alerts`, `GET ${V}/alerts/stats`, `POST ${V}/alerts/read-all`, `PATCH ${V}/alerts/:id/status`,
  `GET ${V}/analytics/overview`,
  `POST ${V}/device/telemetry`,
  `GET ${V}/farms/:id/simulation`, `PATCH ${V}/farms/:id/simulation`, `PUT ${V}/farms/:id/data-mode`,
  `POST ${V}/farms/:id/simulation/start`, `POST ${V}/farms/:id/simulation/stop`, `POST ${V}/farms/:id/simulation/reset`,
  `POST ${V}/farms/:id/simulate/animals`, `POST ${V}/farms/:id/simulate/telemetry`, `POST ${V}/farms/:id/simulate/events`,
];

describe('route inventory matches the contract', () => {
  it('exposes exactly the contract routes (no extra, none missing)', () => {
    const actual = [
      AppController, AuthController, FarmsController, AnimalsController, GeofenceController,
      DevicesController, AlertsController, AnalyticsController, TelemetryController, SimulationController,
    ].flatMap(routesOf);
    expect(actual.sort()).toEqual([...EXPECTED_ROUTES].sort());
  });

  it('legacy unauthenticated device routes do not exist', () => {
    const all = [TelemetryController, AppController].flatMap(routesOf).join('\n');
    expect(all).not.toMatch(/trigger|buzzer|\/status/);
  });
});

const now = new Date('2026-11-08T12:00:00Z');
const animalRow = (over: any = {}) => ({
  id: 'a1', farmId: 'F', name: 'Mira', tagNumber: 'KZ-1', species: 'CATTLE', gender: 'FEMALE',
  breed: null, birthDate: new Date('2024-03-01T00:00:00Z'), photoUrl: null, activeGeofenceId: 'p1',
  lastLatitude: 43.65, lastLongitude: 51.15, lastAccuracy: 4, lastSeenAt: new Date(now.getTime() - 60_000),
  isOutsideGeofence: false, device: { deviceId: 'QAM-1', lastHeartbeatAt: new Date(now.getTime() - 60_000) }, alerts: [],
  ...over,
});

describe('response shapes (key snapshots)', () => {
  const keys = (o: any) => Object.keys(o).sort();
  const forbidden = new RegExp(['secret', 'hash', 'batt' + 'ery', 'shock', 'voltage', 'password'].join('|'), 'i');

  it('AnimalDto', () => {
    const d = toAnimalDto(animalRow(), now.getTime());
    expect(keys(d)).toEqual(
      ['accuracyM', 'birthDate', 'breed', 'collarId', 'farmId', 'gender', 'id', 'lastHeartRate', 'lastHeartRateAt', 'lastSeenAt', 'lat', 'lng', 'name', 'penId', 'photoUrl', 'species', 'status', 'tag', 'isDemo'].sort(),
    );
    expect(d).toMatchObject({ tag: 'KZ-1', penId: 'p1', collarId: 'QAM-1', lat: 43.65, lng: 51.15, status: 'ok', birthDate: '2024-03-01' });
    expect(JSON.stringify(d)).not.toMatch(forbidden);
  });

  it('CollarDto', () => {
    const d = toCollarDto({ deviceId: 'QAM-1', signal: -70, firmwareVersion: '1.0.0', lastHeartbeatAt: new Date(), animal: { id: 'a1', name: 'M' }, secretHash: 'x', isSimulated: true });
    expect(keys(d)).toEqual(['animalId', 'animalName', 'code', 'deviceId', 'firmwareVersion', 'isDemo', 'lastSeenAt', 'signalRssi', 'status']);
    expect(d.isDemo).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(forbidden);
  });

  it('PenDto', () => {
    const poly = { type: 'Polygon', coordinates: [[[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]] };
    const d = toPenDto({ id: 'p1', farmId: 'F', name: 'P', color: '#10B981', polygonJson: poly, _count: { animals: 3 } });
    expect(keys(d)).toEqual(['animalsCount', 'areaHa', 'color', 'farmId', 'id', 'isDemo', 'name', 'polygon']);
    expect(d.animalsCount).toBe(3);
    expect(d.areaHa).toBeGreaterThan(100);
  });

  it('AlertDto', () => {
    const d = toAlertDto({
      id: 'x', type: 'GEOFENCE_BREACH', severity: 'CRITICAL', status: 'ACTIVE', animalId: 'a1', message: 'm',
      latitude: 1, longitude: 2, createdAt: now, isRead: false, deviceId: 'QAM-1',
      animal: { id: 'a1', name: 'Mira', activeGeofence: { name: 'North' } },
    });
    expect(keys(d)).toEqual(['animalId', 'animalName', 'createdAt', 'id', 'isDemo', 'isRead', 'lat', 'lng', 'message', 'penName', 'severity', 'status', 'type']);
    expect(d).toMatchObject({ animalName: 'Mira', penName: 'North', lat: 1, lng: 2, isRead: false });
  });

  it('FarmDto', () => {
    const d = toFarmDto({ id: 'F', name: 'Farm', description: null, timezone: 'Asia/Aqtau', workerCanEditBoundaries: false, ownerId: 'u' }, 'WORKER');
    expect(keys(d)).toEqual(['dataMode', 'description', 'id', 'myRole', 'name', 'timezone', 'workerCanEditBoundaries']);
    expect(d.dataMode).toBe('REAL');
  });
});

describe('animal status', () => {
  const t = now.getTime();
  it('danger beats offline; offline without a collar or after 900 s; warning with an active GPS/limit alert', () => {
    expect(animalStatus(animalRow({ isOutsideGeofence: true, device: null }), t)).toBe('danger');
    expect(animalStatus(animalRow({ device: null }), t)).toBe('offline');
    expect(animalStatus(animalRow({ device: { deviceId: 'Q', lastHeartbeatAt: new Date(t - 901_000) } }), t)).toBe('offline');
    expect(animalStatus(animalRow({ alerts: [{ id: 'x' }] }), t)).toBe('warning');
    expect(animalStatus(animalRow(), t)).toBe('ok');
  });
});

describe('pagination', () => {
  const all = Array.from({ length: 7 }, (_, i) => ({ id: 'i' + i }));
  it('walks pages with a cursor and ends with nextCursor null', () => {
    const p1 = pageOf(all, { limit: 3 });
    expect(p1.items.map((x) => x.id)).toEqual(['i0', 'i1', 'i2']);
    expect(p1.nextCursor).toBe('i2');
    const p2 = pageOf(all, { limit: 3, cursor: p1.nextCursor! });
    expect(p2.items.map((x) => x.id)).toEqual(['i3', 'i4', 'i5']);
    const p3 = pageOf(all, { limit: 3, cursor: p2.nextCursor! });
    expect(p3.items.map((x) => x.id)).toEqual(['i6']);
    expect(p3.nextCursor).toBeNull();
  });
  it('defaults to 50', () => {
    expect(pageOf(Array.from({ length: 80 }, (_, i) => ({ id: String(i) })), {}).items).toHaveLength(50);
  });
});

describe('request DTOs follow the contract names', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const body = (metatype: any, value: any) => pipe.transform(value, { type: 'body', metatype });
  const uuid = '3f2b8c1e-9d4a-4c1b-8f6e-2a7d5b9c0e11';

  it('animal create uses tag / penId / collarId, rejects the old names and bad values', async () => {
    await expect(body(CreateAnimalInputDto, { name: 'A', tag: 'T1', species: 'CATTLE', penId: uuid, collarId: 'QAM-0005' })).resolves.toBeDefined();
    await expect(body(CreateAnimalInputDto, { name: 'A', tagNumber: 'T1', species: 'CATTLE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(body(CreateAnimalInputDto, { name: 'A', tag: 'T1', species: 'CATTLE', penId: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(body(CreateAnimalInputDto, { name: 'A', tag: 'T1', species: 'DRAGON' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(body(CreateAnimalInputDto, { name: 'A', tag: 'x'.repeat(61), species: 'CATTLE' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('steer needs UUIDs and a non-empty list', async () => {
    await expect(body(SteerDto, { animalIds: [uuid], targetPenId: uuid })).resolves.toBeDefined();
    await expect(body(SteerDto, { animalIds: [], targetPenId: uuid })).rejects.toBeInstanceOf(BadRequestException);
    await expect(body(SteerDto, { animalIds: ['x'], targetPenId: uuid })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list query validates status and limit', async () => {
    const q = (v: any) => pipe.transform(v, { type: 'query', metatype: ListAnimalsQueryDto });
    await expect(q({ status: 'danger', limit: '10' })).resolves.toMatchObject({ limit: 10 });
    await expect(q({ status: 'bad' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(q({ limit: '101' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('geofence create uses `polygon`', async () => {
    const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    await expect(body(CreateGeofenceInputDto, { name: 'G', polygon })).resolves.toBeDefined();
    await expect(body(CreateGeofenceInputDto, { name: 'G', polygonJson: polygon })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AnimalsService: collar binding and steering', () => {
  function prismaWith(opts: { animals?: any[]; devices?: any[] } = {}) {
    const animals = opts.animals ?? [{ id: 'a1', farmId: 'F' }, { id: 'a2', farmId: 'F' }];
    const devices = opts.devices ?? [
      { id: 'd1', deviceId: 'QAM-1', farmId: 'F', animalId: null },
      { id: 'd2', deviceId: 'QAM-2', farmId: 'F', animalId: 'a2' },
    ];
    const prisma: any = {
      animal: {
        count: jest.fn(async ({ where }: any) => {
          const ids = where.id?.in ?? [where.id];
          return animals.filter((a) => ids.includes(a.id) && a.farmId === where.farmId).length;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const a = animals.find((x) => x.id === where.id && x.farmId === where.farmId);
          return a ? { ...a, tagNumber: 't', species: 'CATTLE', gender: 'UNKNOWN', createdAt: now, device: devices.find((d) => d.animalId === a.id) ?? null, alerts: [] } : null;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          animals.filter((a) => where.id.in.includes(a.id)).map((a) => ({ ...a, device: devices.find((d) => d.animalId === a.id) ?? null })),
        ),
        updateMany: jest.fn(async ({ where }: any) => ({ count: animals.filter((a) => where.id.in.includes(a.id)).length })),
      },
      geofence: { count: jest.fn(async ({ where }: any) => (where.id === 'pen1' && where.farmId === 'F' ? 1 : 0)) },
      alert: { updateMany: jest.fn(async () => ({ count: 0 })) },
      device: {
        count: jest.fn(async ({ where }: any) => devices.filter((d) => d.deviceId === where.deviceId && d.farmId === where.farmId).length),
        findFirst: jest.fn(async ({ where }: any) => devices.find((d) => d.deviceId === where.deviceId && d.farmId === where.farmId) ?? null),
        updateMany: jest.fn(async ({ where }: any) => {
          const rows = devices.filter((d) => (where.id ? d.id === where.id : d.animalId === where.animalId) && (where.animalId === null ? d.animalId === null : true));
          return { count: rows.length };
        }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    return prisma;
  }

  it('assign-collar: foreign animal or collar -> 404; collar of another animal -> 409', async () => {
    const svc = new AnimalsService(prismaWith());
    await expect(svc.assignCollar('u', 'OTHER', 'a1', 'QAM-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.assignCollar('u', 'F', 'a1', 'QAM-X')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.assignCollar('u', 'F', 'a1', 'QAM-2')).rejects.toBeInstanceOf(ConflictException);
  });

  it('assign-collar: a free collar of the same farm is bound (previous binding released first)', async () => {
    const prisma = prismaWith();
    const res = await new AnimalsService(prisma).assignCollar('u', 'F', 'a1', 'QAM-1');
    expect(res.id).toBe('a1');
    const calls = prisma.device.updateMany.mock.calls.map((c: any) => c[0]);
    expect(calls[0]).toMatchObject({ where: { animalId: 'a1' }, data: { animalId: null } });
    expect(calls[1]).toMatchObject({ where: { id: 'd1', farmId: 'F', animalId: null }, data: { animalId: 'a1' } });
  });

  it('unassign-collar releases the collar', async () => {
    const prisma = prismaWith();
    await new AnimalsService(prisma).unassignCollar('u', 'F', 'a2');
    expect(prisma.device.updateMany).toHaveBeenCalledWith({ where: { animalId: 'a2', farmId: 'F' }, data: { animalId: null } });
  });

  it('steer: foreign animal -> 404 and nothing written', async () => {
    const prisma = prismaWith();
    await expect(new AnimalsService(prisma).steer('u', 'F', { animalIds: ['a1', 'zzz'], targetPenId: 'pen1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.animal.updateMany).not.toHaveBeenCalled();
  });

  it('steer: foreign pen -> 404', async () => {
    const prisma = prismaWith();
    await expect(new AnimalsService(prisma).steer('u', 'F', { animalIds: ['a1'], targetPenId: 'penX' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('steer: changes the pen of the selected animals; those without a reachable collar are listed', async () => {
    const prisma = prismaWith();
    const res = await new AnimalsService(prisma).steer('u', 'F', { animalIds: ['a1', 'a2', 'a2'], targetPenId: 'pen1' });
    expect(prisma.animal.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a1', 'a2'] }, farmId: 'F' }, data: { activeGeofenceId: 'pen1' } });
    expect(res.updated).toBe(2);
    // a1 has no collar, a2's collar never pinged: both offline
    expect(res.skippedOffline.sort()).toEqual(['a1', 'a2']);
  });

  it('steer: an online collar is not listed as skipped', async () => {
    const prisma = prismaWith({ devices: [{ id: 'd2', deviceId: 'QAM-2', farmId: 'F', animalId: 'a2', lastHeartbeatAt: new Date() }] });
    const res = await new AnimalsService(prisma).steer('u', 'F', { animalIds: ['a1', 'a2'], targetPenId: 'pen1' });
    expect(res.skippedOffline).toEqual(['a1']);
  });
});

describe('alerts API', () => {
  it('read-all marks the farm alerts as read and reports the count', async () => {
    const prisma: any = { alert: { updateMany: jest.fn(async () => ({ count: 4 })) } };
    await expect(new AlertsService(prisma).markAllRead('u', 'F')).resolves.toEqual({ updated: 4 });
    expect(prisma.alert.updateMany).toHaveBeenCalledWith({ where: { farmId: 'F', isRead: false }, data: { isRead: true } });
  });

  it('list pages with a cursor and returns AlertDto', async () => {
    const row = (id: string) => ({ id, type: 'GEOFENCE_BREACH', severity: 'CRITICAL', status: 'ACTIVE', message: 'm', createdAt: now, isRead: false, animal: null });
    const prisma: any = { alert: { findMany: jest.fn(async () => [row('a'), row('b'), row('c')]) } };
    const page = await new AlertsService(prisma).listAlerts('u', 'F', { limit: 2, cursor: 'z' });
    expect(page.items.map((x) => x.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('b');
    expect(prisma.alert.findMany.mock.calls[0][0]).toMatchObject({ take: 3, cursor: { id: 'z' }, skip: 1, where: { farmId: 'F' } });
  });

  it('status change marks the alert as read; foreign alert -> 404', async () => {
    const prisma: any = {
      alert: {
        findFirst: jest.fn(async ({ where }: any) => (where.farmId === 'F' ? { id: 'x' } : null)),
        update: jest.fn(async ({ data }: any) => ({ id: 'x', type: 'GPS_LOST', severity: 'WARNING', status: data.status, message: 'm', createdAt: now, isRead: data.isRead, animal: null })),
      },
    };
    const svc = new AlertsService(prisma);
    const res = await svc.updateAlertStatus('u', 'F', 'x', 'ACKNOWLEDGED' as any);
    expect(res).toMatchObject({ status: 'ACKNOWLEDGED', isRead: true });
    await expect(svc.updateAlertStatus('u', 'OTHER', 'x', 'RESOLVED' as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GeofenceService mapping', () => {
  it('detail adds animalIds; areaHa and animalsCount are computed by the server', async () => {
    const poly = { type: 'Polygon', coordinates: [[[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]] };
    const prisma: any = {
      geofence: { findFirst: jest.fn(async () => ({ id: 'p1', farmId: 'F', name: 'P', color: '#fff', polygonJson: poly, animals: [{ id: 'a1' }, { id: 'a2' }] })) },
    };
    const d = await new GeofenceService(prisma).getGeofenceById('u', 'F', 'p1');
    expect(d.animalIds).toEqual(['a1', 'a2']);
    expect(d.animalsCount).toBe(2);
    expect(d.areaHa).toBeGreaterThan(100);
  });
});

describe('error body { statusCode, code, message }', () => {
  it.each([
    [new BadRequestException(['a must be x', 'b must be y']), 400, 'VALIDATION', 'a must be x; b must be y'],
    [new HttpException('no', 401), 401, 'UNAUTHENTICATED', 'no'],
    [forbiddenRole('r'), 403, 'FORBIDDEN_ROLE', 'r'],
    [forbiddenFarm(), 403, 'FORBIDDEN_FARM', undefined],
    [new ForbiddenException('plain'), 403, 'FORBIDDEN_ROLE', 'plain'],
    [new NotFoundException('nf'), 404, 'NOT_FOUND', 'nf'],
    [new ConflictException('c'), 409, 'CONFLICT', 'c'],
    [new HttpException({ statusCode: 429, code: 'RATE_LIMITED', message: 'slow', retryAfterSec: 5 }, 429), 429, 'RATE_LIMITED', 'slow'],
  ])('%#', (err, status, code, message) => {
    const { statusCode, body } = toErrorBody(err);
    expect(statusCode).toBe(status);
    expect(body).toMatchObject({ statusCode: status, code });
    if (message) expect(body.message).toBe(message);
  });

  it('unknown errors become a generic 500 without details; prisma P2002 -> 409', () => {
    const e = toErrorBody(new Error('secret db detail'));
    expect(e.statusCode).toBe(500);
    expect(JSON.stringify(e.body)).not.toMatch(/secret db detail/);
    expect(toErrorBody(Object.assign(new Error('x'), { code: 'P2002' })).statusCode).toBe(409);
    expect(toErrorBody(Object.assign(new Error('x'), { code: 'P2025' })).statusCode).toBe(404);
  });
});
