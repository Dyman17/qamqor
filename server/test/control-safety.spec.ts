import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { CollarControlService } from '../src/telemetry/collar-control.service';
import { CollarControlController } from '../src/telemetry/collar-control.controller';
import { LiveViewersService } from '../src/telemetry/live-viewers.service';
import { GeofenceService } from '../src/geofences/geofence.service';
import { SignalsService } from '../src/signals/signals.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { OfflineWatcherService } from '../src/devices/offline-watcher.service';
import { DevicesService, toCollarDto } from '../src/devices/devices.service';
import { AUTO_RESET_DATA } from '../src/devices/control-mode';
import { FARM_ROLES_KEY } from '../src/farms/roles.decorator';
import { validateEnv } from '../src/config/env.validation';
import { loadAppConfig } from '../src/config/config';

const poly = {
  type: 'Polygon',
  coordinates: [[[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]],
};
const GREEN = 43.65;
const YELLOW = 43.65487;
const ORANGE = 43.654975;
const RED = 43.6552;
const LNG = 51.157;

function useFakeDate(at = Date.UTC(2026, 10, 10, 8, 0, 0)) {
  jest.useFakeTimers({
    now: at,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate',
    ],
  });
}
afterEach(() => jest.useRealTimers());
const tick = (ms = 1000) => jest.setSystemTime(Date.now() + ms);
const ping = (lat = GREEN, over: any = {}): any => ({
  deviceId: 'QAM-0001', timestamp: new Date().toISOString(), latitude: lat, longitude: LNG, accuracy: 5, ...over,
});

/** TelemetryService with the REAL SignalsService on a fake prisma (counts recorded signals). */
function realSignalsSetup(env: Record<string, string> = {}, deviceOver: any = {}) {
  const events: any[] = [];
  const prisma: any = {
    animal: { update: jest.fn() },
    device: { update: jest.fn() },
    telemetry: { create: jest.fn(), findFirst: jest.fn(async () => null) },
    deviceCommand: { findFirst: jest.fn(async () => null), updateMany: jest.fn() },
    signalLimit: { findMany: jest.fn(async () => []) },
    signalEvent: {
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      createMany: jest.fn(async ({ data }: any) => { events.push(...data); }),
    },
    alert: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => data) },
  };
  const alerts: any = {
    triggerGeofenceBreach: jest.fn(), resolveGeofenceBreach: jest.fn(), triggerGpsLost: jest.fn(),
    resolveGpsLost: jest.fn(), restoreDevice: jest.fn(),
  };
  const config: any = { get: (k: string, d: string) => env[k] ?? d };
  const svc = new TelemetryService(
    prisma, new GeofenceService({} as any), alerts, config,
    new SignalsService(prisma, new AlertsService(prisma)), new LiveViewersService(),
  );
  const device: any = {
    id: 'd1', deviceId: 'QAM-0001', code: '00000001', farmId: 'f1', status: 'ONLINE', isSimulated: false,
    lastHeartbeatAt: new Date(), farm: { timezone: 'Asia/Aqtau' }, controlMode: 'AUTO',
    animal: { id: 'a1', name: 'A', species: 'CATTLE', isOutsideGeofence: false, activeGeofence: { polygonJson: poly } },
    ...deviceOver,
  };
  const sounds = () => events.filter((e) => e.level === 'SOUND').length;
  const vibrations = () => events.filter((e) => e.level === 'VIBRATION').length;
  return { svc, prisma, device, sounds, vibrations };
}

describe('escalation has hysteresis (episodes)', () => {
  it('YELLOW/GREEN flapping at 1 s gives one signal per cooldown, not one per re-entry', async () => {
    useFakeDate();
    const { svc, device, sounds } = realSignalsSetup();
    await svc.processDeviceTelemetry(device, ping(GREEN));
    for (let i = 0; i < 25; i++) {
      tick();
      await svc.processDeviceTelemetry(device, ping(i % 2 === 0 ? YELLOW : GREEN));
    }
    expect(sounds()).toBe(1); // 25 s < the 30 s cooldown
    for (let i = 0; i < 20; i++) {
      tick();
      await svc.processDeviceTelemetry(device, ping(i % 2 === 0 ? YELLOW : GREEN));
    }
    expect(sounds()).toBe(2); // 45 s in: the cooldown has passed once, no more
  });

  it('a low-accuracy UNKNOWN ping in between neither resets the episode nor re-fires', async () => {
    useFakeDate();
    const { svc, device, sounds } = realSignalsSetup({ SIGNAL_COOLDOWN_SEC: '300' });
    await svc.processDeviceTelemetry(device, ping(GREEN));
    tick();
    await svc.processDeviceTelemetry(device, ping(YELLOW));
    for (let i = 0; i < 5; i++) {
      tick();
      await svc.processDeviceTelemetry(device, ping(GREEN, { accuracy: 999 }));
      tick();
      await svc.processDeviceTelemetry(device, ping(YELLOW));
    }
    expect(sounds()).toBe(1);
  });

  it('YELLOW -> ORANGE is still immediate, inside the cooldown, once', async () => {
    useFakeDate();
    const { svc, device, sounds, vibrations } = realSignalsSetup({ SIGNAL_COOLDOWN_SEC: '300' });
    await svc.processDeviceTelemetry(device, ping(GREEN));
    tick();
    await svc.processDeviceTelemetry(device, ping(YELLOW));
    expect([sounds(), vibrations()]).toEqual([1, 0]);
    tick();
    await svc.processDeviceTelemetry(device, ping(ORANGE));
    expect([sounds(), vibrations()]).toEqual([2, 1]);
    tick();
    await svc.processDeviceTelemetry(device, ping(ORANGE));
    tick();
    await svc.processDeviceTelemetry(device, ping(YELLOW)); // de-escalation
    tick();
    await svc.processDeviceTelemetry(device, ping(ORANGE)); // back to a rank already reached
    expect([sounds(), vibrations()]).toEqual([2, 1]);
    tick();
    await svc.processDeviceTelemetry(device, ping(RED));
    expect([sounds(), vibrations()]).toEqual([3, 2]);
  });

  it('GREEN for 60 s ends the episode: the next YELLOW is immediate again; 50 s of GREEN is not enough', async () => {
    useFakeDate();
    const short = realSignalsSetup({ SIGNAL_COOLDOWN_SEC: '300' });
    const long = realSignalsSetup({ SIGNAL_COOLDOWN_SEC: '300' });
    for (const [w, greenSec] of [[short, 50], [long, 60]] as const) {
      await w.svc.processDeviceTelemetry(w.device, ping(GREEN));
      tick();
      await w.svc.processDeviceTelemetry(w.device, ping(YELLOW));
      tick(1000);
      await w.svc.processDeviceTelemetry(w.device, ping(GREEN)); // the green stretch starts
      for (let s = 10; s <= greenSec; s += 10) {
        tick(10_000);
        await w.svc.processDeviceTelemetry(w.device, ping(GREEN));
      }
      tick(1000);
      await w.svc.processDeviceTelemetry(w.device, ping(YELLOW));
    }
    expect(short.sounds()).toBe(1);
    expect(long.sounds()).toBe(2);
  });

  it('a YELLOW ping inside the green stretch restarts the 60 s', async () => {
    useFakeDate();
    const { svc, device, sounds } = realSignalsSetup({ SIGNAL_COOLDOWN_SEC: '300' });
    await svc.processDeviceTelemetry(device, ping(GREEN));
    tick();
    await svc.processDeviceTelemetry(device, ping(YELLOW));
    for (let i = 0; i < 4; i++) {
      tick(40_000);
      await svc.processDeviceTelemetry(device, ping(GREEN));
      tick(1000);
      await svc.processDeviceTelemetry(device, ping(YELLOW)); // interrupts: never 60 s of continuous green
    }
    expect(sounds()).toBe(1);
  });

  it('ESCALATION_RESET_SEC is configurable (10 s)', async () => {
    useFakeDate();
    const { svc, device, sounds } = realSignalsSetup({ SIGNAL_COOLDOWN_SEC: '300', ESCALATION_RESET_SEC: '10' });
    await svc.processDeviceTelemetry(device, ping(GREEN));
    tick();
    await svc.processDeviceTelemetry(device, ping(YELLOW));
    tick();
    await svc.processDeviceTelemetry(device, ping(GREEN));
    tick(11_000);
    await svc.processDeviceTelemetry(device, ping(GREEN));
    tick();
    await svc.processDeviceTelemetry(device, ping(YELLOW));
    expect(sounds()).toBe(2);
  });

  it('after a restart (empty memory) the first ping obeys the normal cooldown from the database', async () => {
    useFakeDate();
    const { svc, prisma, device, sounds } = realSignalsSetup();
    prisma.signalEvent.findFirst.mockResolvedValue({ at: new Date(Date.now() - 5000) });
    await svc.processDeviceTelemetry(device, ping(YELLOW));
    expect(sounds()).toBe(0);
  });
});

describe('manual modes are owner only', () => {
  const ctrl = (svc: any = { setControlMode: jest.fn(async () => 'ok'), setManualPosition: jest.fn(async () => 'ok') }) =>
    ({ svc, c: new CollarControlController(svc as any) });

  it('a worker cannot switch to MANUAL or GPS_MANUAL, but can restore AUTO; the owner can do all', async () => {
    const { svc, c } = ctrl();
    const worker = { memberRole: 'WORKER' };
    expect(() => c.setControlMode('QAM-1', { mode: 'MANUAL' }, 'F', worker)).toThrow(ForbiddenException);
    expect(() => c.setControlMode('QAM-1', { mode: 'GPS_MANUAL' }, 'F', worker)).toThrow(ForbiddenException);
    expect(svc.setControlMode).not.toHaveBeenCalled();
    await c.setControlMode('QAM-1', { mode: 'AUTO' }, 'F', worker);
    expect(svc.setControlMode).toHaveBeenCalledWith('F', 'QAM-1', 'AUTO');
    for (const mode of ['AUTO', 'MANUAL', 'GPS_MANUAL'] as const) await c.setControlMode('QAM-1', { mode }, 'F', { memberRole: 'OWNER' });
    expect(svc.setControlMode).toHaveBeenCalledTimes(4);
  });

  it('manual-position carries @FarmRoles(OWNER)', () => {
    expect(Reflect.getMetadata(FARM_ROLES_KEY, CollarControlController.prototype.setManualPosition)).toEqual(['OWNER']);
  });
});

describe('manual modes lapse to AUTO without operator activity', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000);
  const realFix = (over: any = {}) => ({ latitude: 43.6501, longitude: LNG, accuracy: 5, timestamp: ago(0), ...over });

  function lazy(deviceOver: any, animalOver: any = {}, env: Record<string, string> = {}, fix: any = null) {
    const prisma: any = {
      animal: { update: jest.fn() },
      device: { update: jest.fn() },
      telemetry: {
        create: jest.fn(),
        findFirst: jest.fn(async ({ where }: any) => (where.latitude ? fix : null)),
      },
      deviceCommand: { findFirst: jest.fn(async () => null), updateMany: jest.fn() },
    };
    const alerts: any = {
      triggerGeofenceBreach: jest.fn(), resolveGeofenceBreach: jest.fn(), triggerGpsLost: jest.fn(),
      resolveGpsLost: jest.fn(), restoreDevice: jest.fn(),
    };
    const signals: any = { applyLimits: jest.fn(async (a: any) => ({ sound: a.sound, vibrate: a.vibrate, suppressed: false })) };
    const config: any = { get: (k: string, d: string) => env[k] ?? d };
    const svc = new TelemetryService(prisma, new GeofenceService({} as any), alerts, config, signals, new LiveViewersService());
    const device: any = {
      id: 'd1', deviceId: 'QAM-0001', code: '00000001', farmId: 'f1', status: 'ONLINE', isSimulated: false,
      lastHeartbeatAt: new Date(), farm: { timezone: 'Asia/Aqtau' }, manualLatitude: null, manualLongitude: null,
      animal: { id: 'a1', name: 'A', species: 'CATTLE', isOutsideGeofence: false, activeGeofence: { polygonJson: poly }, ...animalOver },
      ...deviceOver,
    };
    return { svc, prisma, alerts, signals, device };
  }

  it('GPS_MANUAL older than the TTL: the ping reverts to AUTO, clears the point, uses the real GPS and is not stale', async () => {
    const { svc, prisma, device } = lazy(
      { controlMode: 'GPS_MANUAL', manualLatitude: YELLOW, manualLongitude: LNG, controlActivityAt: ago(121) },
      { lastSeenAt: new Date(Date.now() + 60_000) }, // the last drag
      {},
      realFix({ timestamp: ago(5) }),
    );
    const r: any = await svc.processDeviceTelemetry(device, ping(RED));
    expect(prisma.device.update.mock.calls[0][0].data).toEqual(AUTO_RESET_DATA);
    expect(r).toMatchObject({ controlMode: 'AUTO', zone: 'RED', sound: true, vibrate: true });
    // the real position of the ping is stored on the animal: it was not treated as stale
    const written = prisma.animal.update.mock.calls.map((c: any) => c[0].data);
    expect(written.some((d: any) => d.lastLatitude === RED)).toBe(true);
  });

  it('MANUAL older than the TTL: automatic signals come back', async () => {
    const { svc, device } = lazy({ controlMode: 'MANUAL', controlActivityAt: ago(130) });
    expect(await svc.processDeviceTelemetry(device, ping(RED))).toMatchObject({ controlMode: 'AUTO', sound: true });
  });

  it('within the TTL nothing changes; CONTROL_MODE_TTL_MIN is honoured; no recorded activity counts as lapsed', async () => {
    const fresh = lazy({ controlMode: 'MANUAL', controlActivityAt: ago(119) });
    expect(await fresh.svc.processDeviceTelemetry(fresh.device, ping(RED))).toMatchObject({ controlMode: 'MANUAL', sound: false });
    expect(fresh.prisma.device.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: AUTO_RESET_DATA }));
    const short = lazy({ controlMode: 'MANUAL', controlActivityAt: ago(2) }, {}, { CONTROL_MODE_TTL_MIN: '1' });
    expect(await short.svc.processDeviceTelemetry(short.device, ping(RED))).toMatchObject({ controlMode: 'AUTO' });
    const none = lazy({ controlMode: 'MANUAL', controlActivityAt: null });
    expect(await none.svc.processDeviceTelemetry(none.device, ping(RED))).toMatchObject({ controlMode: 'AUTO' });
  });

  it('the background watcher reverts lapsed collars, clears the point and restores the animal of a GPS_MANUAL one', async () => {
    const rows = [
      { id: 'd1', deviceId: 'QAM-1', controlMode: 'GPS_MANUAL', animalId: 'a1' },
      { id: 'd2', deviceId: 'QAM-2', controlMode: 'MANUAL', animalId: 'a2' },
      { id: 'd3', deviceId: 'QAM-3', controlMode: 'MANUAL', animalId: 'a3' }, // lost the race: activity arrived
    ];
    const prisma: any = {
      device: {
        findMany: jest.fn(async () => rows),
        updateMany: jest.fn(async ({ where }: any) => ({ count: where.id === 'd3' ? 0 : 1 })),
      },
      telemetry: { findFirst: jest.fn(async () => ({ latitude: 1, longitude: 2, accuracy: 5, timestamp: new Date(1000) })) },
      animal: { update: jest.fn() },
    };
    const watcher = new OfflineWatcherService(prisma, {} as any);
    const now = new Date(Date.UTC(2026, 10, 10, 8, 0, 0));
    expect(await watcher.expireControlModes(now)).toBe(2);
    const find = prisma.device.findMany.mock.calls[0][0].where;
    expect(find).toMatchObject({ controlMode: { not: 'AUTO' }, isSimulated: false });
    const cutoff = find.OR[0].controlActivityAt.lt as Date;
    expect(now.getTime() - cutoff.getTime()).toBe(loadAppConfig({}).controlModeTtlMin * 60_000);
    expect(find.OR[1]).toEqual({ controlActivityAt: null });
    for (const c of prisma.device.updateMany.mock.calls) expect(c[0].data).toEqual(AUTO_RESET_DATA);
    // only the GPS_MANUAL collar's animal is restored to its last real fix
    expect(prisma.animal.update).toHaveBeenCalledTimes(1);
    expect(prisma.animal.update.mock.calls[0][0]).toMatchObject({ where: { id: 'a1' }, data: { lastLatitude: 1, lastLongitude: 2, lastSeenAt: new Date(1000) } });
  });

  it('the DTO shows since / expiry for a manual mode and nulls in AUTO', () => {
    const since = new Date('2026-11-10T08:00:00Z');
    const d = toCollarDto({ deviceId: 'Q', animal: null, controlMode: 'MANUAL', controlModeSince: since, controlActivityAt: new Date('2026-11-10T08:30:00Z') });
    expect(d.controlModeSince).toBe('2026-11-10T08:00:00.000Z');
    expect(d.controlModeExpiresAt).toBe('2026-11-10T10:30:00.000Z'); // + 120 min
    expect(toCollarDto({ deviceId: 'Q', animal: null })).toMatchObject({ controlModeSince: null, controlModeExpiresAt: null });
  });

  it('a test command in a manual mode refreshes the activity; in AUTO it does not touch the device', async () => {
    for (const [controlMode, touched] of [['MANUAL', true], ['AUTO', false]] as const) {
      const prisma: any = {
        device: {
          findFirst: jest.fn(async () => ({ id: 'd1', deviceId: 'QAM-1', farmId: 'F', controlMode })),
          update: jest.fn(),
        },
        deviceCommand: { create: jest.fn(async () => ({ id: 'c1' })) },
      };
      await new DevicesService(prisma).queueTestSignal('u', 'F', 'QAM-1', { signal: 'SOUND' });
      expect(prisma.device.update.mock.calls.length).toBe(touched ? 1 : 0);
      if (touched) expect(prisma.device.update.mock.calls[0][0].data.controlActivityAt).toBeInstanceOf(Date);
    }
  });

  it('CONTROL_MODE_TTL_MIN is validated as a positive integer', () => {
    const good = { DATABASE_URL: 'postgresql://u:p@localhost:5432/x', JWT_SECRET: 'a'.repeat(16) + 'B'.repeat(16) + '1' };
    expect(() => validateEnv({ ...good, CONTROL_MODE_TTL_MIN: '30' })).not.toThrow();
    for (const bad of ['0', '-5', 'abc', '1.5']) expect(() => validateEnv({ ...good, CONTROL_MODE_TTL_MIN: bad })).toThrow(/CONTROL_MODE_TTL_MIN/);
    expect(() => validateEnv({ ...good, ESCALATION_RESET_SEC: 'x' })).toThrow(/ESCALATION_RESET_SEC/);
    expect(loadAppConfig({}).controlModeTtlMin).toBe(120);
    expect(loadAppConfig({ CONTROL_MODE_TTL_MIN: '15' }).controlModeTtlMin).toBe(15);
  });
});

describe('leaving GPS_MANUAL does not leave the animal "newer" than the real collar', () => {
  function control(telemetryRow: any) {
    const device: any = {
      id: 'd1', deviceId: 'QAM-00000001', code: '00000001', farmId: 'F', isSimulated: false, controlMode: 'GPS_MANUAL',
      manualLatitude: YELLOW, manualLongitude: LNG, controlModeSince: new Date(), controlActivityAt: new Date(),
      animal: { id: 'a1', name: 'Mira', species: 'CATTLE', isOutsideGeofence: false, activeGeofence: { polygonJson: poly } },
    };
    const prisma: any = {
      device: { findFirst: jest.fn(async () => device), update: jest.fn(async ({ data }: any) => ({ ...device, ...data, animal: { id: 'a1', name: 'Mira' } })) },
      animal: { update: jest.fn() },
      telemetry: { findFirst: jest.fn(async () => telemetryRow) },
    };
    const alerts: any = { resolveGpsLost: jest.fn() };
    const telemetry = new TelemetryService(prisma, new GeofenceService({} as any), alerts, { get: (_k: string, d: string) => d } as any, {} as any, new LiveViewersService());
    return { svc: new CollarControlService(prisma, new GeofenceService({} as any), alerts, telemetry), prisma };
  }

  it('restores the last reliable real fix stored in the telemetry', async () => {
    const ts = new Date('2026-11-10T07:59:00Z');
    const { svc, prisma } = control({ latitude: 43.6501, longitude: LNG, accuracy: 6, timestamp: ts });
    await svc.setControlMode('F', 'QAM-00000001', 'AUTO');
    expect(prisma.telemetry.findFirst.mock.calls[0][0].where).toMatchObject({ deviceId: 'QAM-00000001', accuracy: { lte: 35 } });
    expect(prisma.animal.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { lastLatitude: 43.6501, lastLongitude: LNG, lastAccuracy: 6, lastSeenAt: ts },
    });
  });

  it('with no real fix on record lastSeenAt is cleared, so the first real ping cannot be stale', async () => {
    const { svc, prisma } = control(null);
    await svc.setControlMode('F', 'QAM-00000001', 'MANUAL');
    expect(prisma.animal.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { lastSeenAt: null } });
  });

  it('switching between other modes or staying in GPS_MANUAL leaves the animal alone', async () => {
    const stay = control(null);
    await stay.svc.setControlMode('F', 'QAM-00000001', 'GPS_MANUAL');
    expect(stay.prisma.animal.update).not.toHaveBeenCalled();
  });

  it('the real ping after the switch is processed (not stale) end to end', async () => {
    useFakeDate();
    // animal row as left by a drag: lastSeenAt = server time of the drag; after leaving it is cleared
    const w = realSignalsSetup({}, { controlMode: 'AUTO' });
    w.device.animal.lastSeenAt = null;
    await w.svc.processDeviceTelemetry(w.device, ping(RED));
    expect(w.prisma.animal.update.mock.calls[0][0].data).toMatchObject({ lastLatitude: RED });
  });
});

describe('GPS_MANUAL stores the REAL GPS in the telemetry row', () => {
  it('latitude/longitude/accuracy of the row are the collar fix, never the manual point', async () => {
    const w = realSignalsSetup({}, { controlMode: 'GPS_MANUAL', manualLatitude: YELLOW, manualLongitude: 51.16, controlActivityAt: new Date() });
    await w.svc.processDeviceTelemetry(w.device, ping(43.6471, { longitude: 51.1519, accuracy: 7 }));
    const row = w.prisma.telemetry.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ latitude: 43.6471, longitude: 51.1519, accuracy: 7 });
    expect(row.latitude).not.toBe(YELLOW);
    expect(row.longitude).not.toBe(51.16);
  });
});

describe('alert creation is idempotent under a concurrent drag PUT and ping', () => {
  it('two simultaneous triggerGeofenceBreach calls end with ONE ACTIVE alert and no error (partial unique index, P2002 handled)', async () => {
    const store: any[] = [];
    const prisma: any = {
      alert: {
        findFirst: jest.fn(async ({ where }: any) =>
          // both callers look before either creates, like two requests racing
          where.status === 'ACTIVE' ? store.find((a) => a.dedupeKey === where.dedupeKey && a.status === 'ACTIVE') ?? null : null,
        ),
        create: jest.fn(async ({ data }: any) => {
          if (store.some((a) => a.dedupeKey === data.dedupeKey && a.status === 'ACTIVE')) {
            throw Object.assign(new Error('unique'), { code: 'P2002' });
          }
          const row = { id: 'al' + store.length, ...data };
          store.push(row);
          return row;
        }),
      },
    };
    const alerts = new AlertsService(prisma);
    const args = { farmId: 'F', animalId: 'a1', animalName: 'A', deviceId: 'Q', latitude: RED, longitude: LNG, freshBreach: true };
    const [x, y] = await Promise.all([alerts.triggerGeofenceBreach(args), alerts.triggerGeofenceBreach(args)]);
    expect(store.filter((a) => a.status === 'ACTIVE')).toHaveLength(1);
    expect(x).toBeTruthy();
    expect(y).toBeTruthy();
    expect((x as any).id).toBe((y as any).id);
  });
});
