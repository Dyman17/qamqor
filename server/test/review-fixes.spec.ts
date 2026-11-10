import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Reflector } from '@nestjs/core';
import { HttpException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { AuthController } from '../src/auth/auth.controller';
import { InvitationsService } from '../src/farms/invitations.service';
import { FarmsService } from '../src/farms/farms.service';
import { ConsoleMailer } from '../src/mail/mailer';
import { AppController } from '../src/app.controller';
import { AlertsService } from '../src/alerts/alerts.service';
import { AnimalsService } from '../src/animals/animals.service';
import { OfflineWatcherService } from '../src/devices/offline-watcher.service';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { GeofenceService } from '../src/geofences/geofence.service';
import { SignalsService } from '../src/signals/signals.service';
import { RateLimitGuard, RateLimiterService } from '../src/common/rate-limit';
import { loadAppConfig } from '../src/config/config';
import { validateEnv } from '../src/config/env.validation';
import { configureApp } from '../src/bootstrap';
import { toErrorBody } from '../src/common/api-exception.filter';

const jwt: any = { sign: () => 't' };
const config: any = { get: () => 'https://app.example' };
const mailer = (status: 'none' | 'configured') => ({ status: () => status, send: jest.fn(async (_m?: any) => undefined) });

describe('1. the mailer never pretends to send', () => {
  it('ConsoleMailer: none in production, configured (logs) elsewhere', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(new ConsoleMailer().status()).toBe('none');
    process.env.NODE_ENV = 'development';
    expect(new ConsoleMailer().status()).toBe('configured');
    process.env.NODE_ENV = prev;
  });

  function invSvc(m: any) {
    const farm = { id: 'F', name: 'Farm', ownerId: 'o' };
    const prisma: any = {
      farmMember: { findUnique: jest.fn(async ({ where }: any) => (where.userId_farmId.userId === 'o' ? { role: 'OWNER', farm } : null)) },
      user: { findUnique: jest.fn(async () => null) },
      invitation: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async ({ data }: any) => ({ id: 'i1', createdAt: new Date(), acceptedAt: null, revokedAt: null, ...data })),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    return new InvitationsService(prisma, new FarmsService(prisma), m, config);
  }

  it('no transport: invitation is created, nothing is sent, the owner gets delivered:false and the link', async () => {
    const m = mailer('none');
    const res: any = await invSvc(m).create('o', 'F', 'new@mail.kz');
    expect(res).toMatchObject({ email: 'new@mail.kz', status: 'PENDING', delivered: false });
    expect(res.inviteUrl).toMatch(/^https:\/\/app\.example\/invite\?token=[A-Za-z0-9_-]{40,}$/);
    expect(m.send).not.toHaveBeenCalled();
  });

  it('real transport: delivered:true and no link in the response', async () => {
    const m = mailer('configured');
    const res: any = await invSvc(m).create('o', 'F', 'new@mail.kz');
    expect(res.delivered).toBe(true);
    expect(res).not.toHaveProperty('inviteUrl');
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it('a transport that fails is reported as delivered:false with the link', async () => {
    const m = mailer('configured');
    m.send.mockRejectedValue(new Error('smtp down'));
    const res: any = await invSvc(m).create('o', 'F', 'new@mail.kz');
    expect(res.delivered).toBe(false);
    expect(res.inviteUrl).toContain('/invite?token=');
  });

  it('password reset request -> 503 MAIL_NOT_CONFIGURED without a transport, whatever the email', async () => {
    const prisma: any = { user: { findUnique: jest.fn() } };
    const svc = new AuthService(prisma, jwt, mailer('none') as any, config);
    const ctrl = new AuthController(svc);
    let err: any;
    try {
      ctrl.requestReset({ email: 'a@b.kz' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);
    expect(toErrorBody(err).body).toMatchObject({ statusCode: 503, code: 'MAIL_NOT_CONFIGURED' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('password reset request still returns normally with a transport', () => {
    const svc = new AuthService({ user: { findUnique: jest.fn(async () => null) } } as any, jwt, mailer('configured') as any, config);
    expect(() => new AuthController(svc).requestReset({ email: 'a@b.kz' })).not.toThrow();
  });

  it('/health reports mail: none | configured', () => {
    expect(new AppController(mailer('none') as any).getHealth().mail).toBe('none');
    expect(new AppController(mailer('configured') as any).getHealth().mail).toBe('configured');
  });
});

describe('2. acknowledged alerts are not re-raised until the condition clears', () => {
  function world(existing: any[]) {
    const rows = [...existing];
    const inS = (w: any, st: string) => (w && w.in ? w.in.includes(st) : w === st);
    const prisma: any = {
      alert: {
        findFirst: jest.fn(async ({ where }: any) => rows.find((a) => a.dedupeKey === where.dedupeKey && (where.status === undefined || inS(where.status, a.status))) ?? null),
        findMany: jest.fn(async ({ where }: any) => rows.filter((a) => a.animalId === where.animalId && a.type === where.type && inS(where.status, a.status))),
        create: jest.fn(async ({ data }: any) => { rows.push({ id: 'n' + rows.length, ...data }); return rows[rows.length - 1]; }),
        update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((a) => a.id === where.id), data)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hit = rows.filter((a) => a.animalId === where.animalId && a.type === where.type && inS(where.status, a.status));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
      },
    };
    return { prisma, rows, svc: new AlertsService(prisma) };
  }
  const breach = { farmId: 'F', animalId: 'a1', animalName: 'A', deviceId: 'Q', latitude: 1, longitude: 2 };
  const ack = (type: string) => ({ id: 'x', animalId: 'a1', type, status: 'ACKNOWLEDGED', dedupeKey: `${type}:a1` });

  it('GEOFENCE_BREACH acknowledged -> no new alert while still outside; re-armed after the return', async () => {
    const { svc, rows, prisma } = world([ack('GEOFENCE_BREACH')]);
    await svc.triggerGeofenceBreach(breach);
    expect(prisma.alert.create).not.toHaveBeenCalled();
    await svc.resolveGeofenceBreach(breach); // the animal is back: acknowledged alert is resolved
    expect(rows[0].status).toBe('RESOLVED');
    expect(rows.some((r) => r.type === 'GEOFENCE_RETURN')).toBe(true);
    await svc.triggerGeofenceBreach({ ...breach, freshBreach: true }); // leaves again: a new alert is raised
    expect(rows.filter((r) => r.type === 'GEOFENCE_BREACH' && r.status === 'ACTIVE')).toHaveLength(1);
  });

  it('GPS_LOST acknowledged -> not re-raised; resolved by a good fix', async () => {
    const { svc, rows, prisma } = world([ack('GPS_LOST')]);
    await svc.triggerGpsLost({ farmId: 'F', animalId: 'a1', animalName: 'A', deviceId: 'Q' });
    expect(prisma.alert.create).not.toHaveBeenCalled();
    await svc.resolveGpsLost('a1');
    expect(rows[0].status).toBe('RESOLVED');
  });

  it('DEVICE_OFFLINE acknowledged -> not re-raised; a ping resolves it and records DEVICE_RESTORED', async () => {
    const { svc, rows, prisma } = world([ack('DEVICE_OFFLINE')]);
    await svc.triggerDeviceOffline({ farmId: 'F', animalId: 'a1', animalName: 'A', deviceId: 'Q', lastSeenAt: new Date() });
    expect(prisma.alert.create).not.toHaveBeenCalled();
    await svc.restoreDevice({ farmId: 'F', animalId: 'a1', animalName: 'A', deviceId: 'Q' });
    expect(rows[0].status).toBe('RESOLVED');
    expect(rows.some((r) => r.type === 'DEVICE_RESTORED')).toBe(true);
  });
});

describe('3. TRUST_PROXY_HOPS', () => {
  it('defaults: 1 in production, 0 elsewhere; explicit value wins; junk falls back', () => {
    expect(loadAppConfig({ NODE_ENV: 'production' }).trustProxyHops).toBe(1);
    expect(loadAppConfig({ NODE_ENV: 'development' }).trustProxyHops).toBe(0);
    expect(loadAppConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' }).trustProxyHops).toBe(2);
    expect(loadAppConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' }).trustProxyHops).toBe(0);
    expect(loadAppConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: 'x' }).trustProxyHops).toBe(1);
  });
  it('validateEnv rejects a negative or non-numeric value', () => {
    const good = { DATABASE_URL: 'postgresql://u:p@localhost/x', JWT_SECRET: 'a'.repeat(16) + 'B'.repeat(16) + '1' };
    expect(() => validateEnv({ ...good, TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => validateEnv({ ...good, TRUST_PROXY_HOPS: '1' })).not.toThrow();
  });
  it('configureApp applies the hop count to express', () => {
    const set = jest.fn();
    const app: any = { disable: jest.fn(), set, use: jest.fn(), useBodyParser: jest.fn(), enableCors: jest.fn(), useGlobalFilters: jest.fn(), useGlobalPipes: jest.fn() };
    configureApp(app, loadAppConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' }));
    expect(set).toHaveBeenCalledWith('trust proxy', 2);
    set.mockClear();
    configureApp(app, loadAppConfig({ NODE_ENV: 'development' }));
    expect(set).not.toHaveBeenCalled();
  });
  it('render.yaml and .env.example declare it', () => {
    const root = path.join(__dirname, '..', '..');
    expect(fs.readFileSync(path.join(root, 'render.yaml'), 'utf8')).toMatch(/key: TRUST_PROXY_HOPS\s+value: "1"/);
    expect(fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8')).toMatch(/^TRUST_PROXY_HOPS=/m);
  });
});

describe('4. per-email login limit independent of the IP', () => {
  it('the 21st attempt on one email from rotating IPs is blocked', () => {
    const guard = new RateLimitGuard(new Reflector(), new RateLimiterService());
    const ctx = (ip: string): any => ({
      getHandler: () => AuthController.prototype.login,
      switchToHttp: () => ({ getRequest: () => ({ ip, body: { email: 'Victim@b.kz' } }) }),
    });
    for (let i = 0; i < 20; i++) expect(guard.canActivate(ctx('10.0.0.' + i))).toBe(true);
    expect(() => guard.canActivate(ctx('10.0.1.1'))).toThrow(HttpException);
    // another account is unaffected
    const other: any = { getHandler: () => AuthController.prototype.login, switchToHttp: () => ({ getRequest: () => ({ ip: '10.0.2.2', body: { email: 'other@b.kz' } }) }) };
    expect(guard.canActivate(other)).toBe(true);
  });
  it('README states the single-instance assumption', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')).toMatch(/один экземпляр/i);
  });
});

describe('6. telemetry: stale and retried pings', () => {
  const poly = { type: 'Polygon', coordinates: [[[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]] };
  function setup(animalOver: any = {}, duplicate = false) {
    const prisma: any = {
      animal: { update: jest.fn() }, device: { update: jest.fn() },
      telemetry: { create: jest.fn(), findFirst: jest.fn(async () => (duplicate ? { id: 't' } : null)) },
      deviceCommand: { findFirst: jest.fn(async () => null), updateMany: jest.fn() },
      signalLimit: { findMany: jest.fn(async () => []) },
      signalEvent: { count: jest.fn(async () => 0), createMany: jest.fn(), findFirst: jest.fn(async () => null) },
      alert: { findFirst: jest.fn(async () => null), create: jest.fn(), updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    const alerts = new AlertsService(prisma);
    const svc = new TelemetryService(prisma, new GeofenceService({} as any), alerts, { get: (_k: string, d: string) => d } as any, new SignalsService(prisma, alerts));
    const device: any = {
      id: 'd', deviceId: 'QAM-1', farmId: 'F', farm: { timezone: 'Asia/Aqtau' },
      animal: { id: 'a1', name: 'A', isOutsideGeofence: false, activeGeofence: { polygonJson: poly }, ...animalOver },
    };
    return { prisma, svc, device };
  }
  const ping = (iso: string, lat = 43.6552): any => ({ deviceId: 'QAM-1', timestamp: iso, latitude: lat, longitude: 51.157, accuracy: 5 });

  it('ping not newer than lastSeenAt does not move the animal', async () => {
    const t = new Date(Date.now() - 30_000);
    const { svc, device, prisma } = setup({ lastSeenAt: t });
    await svc.processDeviceTelemetry(device, ping(t.toISOString()));
    expect(prisma.animal.update).not.toHaveBeenCalled();
    await svc.processDeviceTelemetry(device, ping(new Date(t.getTime() - 5000).toISOString()));
    expect(prisma.animal.update).not.toHaveBeenCalled();
  });

  it('a newer ping updates the position', async () => {
    const { svc, device, prisma } = setup({ lastSeenAt: new Date(Date.now() - 60_000) });
    await svc.processDeviceTelemetry(device, ping(new Date().toISOString()));
    expect(prisma.animal.update).toHaveBeenCalledTimes(1);
  });

  it('a retried (deviceId, timestamp) ping is answered but not recorded or counted again', async () => {
    const iso = new Date().toISOString();
    const first = setup();
    await first.svc.processDeviceTelemetry(first.device, ping(iso));
    expect(first.prisma.signalEvent.createMany).toHaveBeenCalledTimes(1);
    expect(first.prisma.telemetry.create).toHaveBeenCalledTimes(1);

    const retry = setup({}, true);
    const res: any = await retry.svc.processDeviceTelemetry(retry.device, ping(iso));
    expect(res.zone).toBe('RED');
    expect(res.sound).toBe(false); // a retried ping never delivers a signal
    expect(res.vibrate).toBe(false);
    expect(retry.prisma.signalEvent.createMany).not.toHaveBeenCalled();
    expect(retry.prisma.telemetry.create).not.toHaveBeenCalled();
    expect(retry.prisma.telemetry.findFirst.mock.calls[0][0].where).toMatchObject({ deviceId: 'QAM-1', timestamp: new Date(iso) });
  });
});

describe('7. offline watcher writes on the lock transaction', () => {
  function world(openAlerts: any[] = []) {
    const mk = () => ({
      findMany: jest.fn(async () => openAlerts),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => data),
    });
    const prisma: any = { alert: mk(), $queryRaw: jest.fn(async () => [{ locked: true }]) };
    const tx: any = {
      alert: mk(),
      $queryRaw: (...a: any[]) => prisma.$queryRaw(...a),
      device: {
        updateMany: jest.fn(async () => ({ count: 2 })),
        findMany: jest.fn(async () => [
          { id: 'd1', deviceId: 'Q1', farmId: 'F', lastHeartbeatAt: new Date(Date.now() - 3600_000), animal: { id: 'a1', name: 'A' } },
          { id: 'd2', deviceId: 'Q2', farmId: 'F', lastHeartbeatAt: new Date(Date.now() - 3600_000), animal: { id: 'a2', name: 'B' } },
        ]),
      },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(tx));
    return { prisma, tx, watcher: new OfflineWatcherService(prisma, new AlertsService(prisma)) };
  }

  it('every alert read and write goes through tx, never the shared client (works with connection_limit=1)', async () => {
    const { prisma, tx, watcher } = world();
    await watcher.tick();
    expect(tx.alert.create).toHaveBeenCalledTimes(2);
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
    expect(prisma.alert.findMany).not.toHaveBeenCalled();
  });

  it('devices with an ACTIVE or ACKNOWLEDGED offline alert are skipped', async () => {
    const { tx, watcher } = world([{ dedupeKey: 'DEVICE_OFFLINE:a1' }]);
    await watcher.tick();
    expect(tx.alert.findMany.mock.calls[0][0].where.status).toEqual({ in: ['ACTIVE', 'ACKNOWLEDGED'] });
    expect(tx.alert.create).toHaveBeenCalledTimes(1);
    expect(tx.alert.create.mock.calls[0][0].data.animalId).toBe('a2');
  });
});

describe('8. unassign and delete resolve the animal\'s collar alerts', () => {
  function world() {
    const prisma: any = {
      animal: { count: jest.fn(async () => 1), findFirst: jest.fn(async () => ({ id: 'a1', farmId: 'F', tagNumber: 't', species: 'CATTLE', gender: 'UNKNOWN', device: null, alerts: [] })), delete: jest.fn() },
      device: { updateMany: jest.fn(async () => ({ count: 1 })) },
      alert: { updateMany: jest.fn(async () => ({ count: 2 })) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    return { prisma, svc: new AnimalsService(prisma) };
  }
  const expectResolved = (prisma: any) => {
    const call = prisma.alert.updateMany.mock.calls[0][0];
    expect(call.where.animalId).toBe('a1');
    expect(call.where.type.in.sort()).toEqual(['DEVICE_OFFLINE', 'GPS_LOST']);
    expect(call.where.status.in).toEqual(expect.arrayContaining(['ACTIVE', 'ACKNOWLEDGED']));
    expect(call.data.status).toBe('RESOLVED');
  };

  it('unassignCollar', async () => {
    const { prisma, svc } = world();
    await svc.unassignCollar('u', 'F', 'a1');
    expectResolved(prisma);
  });
  it('deleteAnimal (before the animal row is deleted)', async () => {
    const { prisma, svc } = world();
    await svc.deleteAnimal('u', 'F', 'a1');
    expectResolved(prisma);
    expect(prisma.alert.updateMany.mock.invocationCallOrder[0]).toBeLessThan(prisma.animal.delete.mock.invocationCallOrder[0]);
  });
});

describe('10. migration 0011_lower_emails', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '0011_lower_emails', 'migration.sql'), 'utf8');
  it('lower-cases users.email without colliding with the unique index', () => {
    expect(sql).toMatch(/UPDATE "users"[\s\S]*SET "email" = lower\(/);
    expect(sql).toMatch(/NOT EXISTS/);
  });
});
