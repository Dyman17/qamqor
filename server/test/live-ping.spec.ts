import 'reflect-metadata';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { LiveViewersService, MAX_STREAMS_PER_USER } from '../src/telemetry/live-viewers.service';
import { GeofenceService } from '../src/geofences/geofence.service';
import { SignalsService } from '../src/signals/signals.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { AnimalsService } from '../src/animals/animals.service';
import { DevicesController } from '../src/devices/devices.controller';
import { DevicesService } from '../src/devices/devices.service';
import { RATE_LIMIT_KEY, RateLimitGuard, RateLimiterService } from '../src/common/rate-limit';
import { validateEnv } from '../src/config/env.validation';

const poly = {
  type: 'Polygon',
  coordinates: [[[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]],
};
const GREEN = 43.65;
const RED = 43.6552;

function useFakeDate(at = Date.UTC(2026, 10, 9, 8, 0, 0)) {
  jest.useFakeTimers({
    now: at,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
      'clearInterval', 'setTimeout', 'clearTimeout',
    ],
  });
}
afterEach(() => jest.useRealTimers());

function setup(env: Record<string, string> = {}, deviceOver: any = {}, animalOver: any = {}) {
  const prisma: any = {
    animal: { update: jest.fn() },
    device: { update: jest.fn() },
    telemetry: { create: jest.fn(), findFirst: jest.fn(async () => null) },
    deviceCommand: { findFirst: jest.fn(async () => null), updateMany: jest.fn() },
  };
  const alerts: any = {
    triggerGeofenceBreach: jest.fn(), resolveGeofenceBreach: jest.fn(), triggerGpsLost: jest.fn(),
    resolveGpsLost: jest.fn(), restoreDevice: jest.fn(),
  };
  const signals: any = { applyLimits: jest.fn(async (a: any) => ({ sound: a.sound, vibrate: a.vibrate, suppressed: false })) };
  const live = new LiveViewersService();
  const config: any = { get: (k: string, d: string) => env[k] ?? d };
  const svc = new TelemetryService(prisma, new GeofenceService({} as any), alerts, config, signals, live);
  const device: any = {
    id: 'd1', deviceId: 'QAM-0001', code: '00000001', farmId: 'f1', status: 'ONLINE',
    lastHeartbeatAt: new Date(), farm: { timezone: 'Asia/Aqtau' },
    animal: { id: 'a1', name: 'A', species: 'CATTLE', isOutsideGeofence: false, activeGeofence: { polygonJson: poly }, ...animalOver },
    ...deviceOver,
  };
  return { svc, prisma, alerts, signals, live, device };
}
const ping = (lat = GREEN, over: any = {}): any => ({
  deviceId: 'QAM-0001', timestamp: new Date().toISOString(), latitude: lat, longitude: 51.157, accuracy: 5, ...over,
});

describe('LiveViewersService', () => {
  it('counts viewers, stays live for the linger period after the last one left', () => {
    const live = new LiveViewersService();
    let t = 1_000_000;
    live.now = () => t;
    expect(live.isLive('f', 120)).toBe(false);
    const a = live.join('f');
    const b = live.join('f');
    expect(live.viewerCount('f')).toBe(2);
    a();
    a(); // idempotent
    expect(live.viewerCount('f')).toBe(1);
    expect(live.isLive('f', 120)).toBe(true);
    b();
    expect(live.viewerCount('f')).toBe(0);
    t += 119_000;
    expect(live.isLive('f', 120)).toBe(true);
    t += 2_000;
    expect(live.isLive('f', 120)).toBe(false);
    expect(live.isLive('other', 120)).toBe(false);
  });

  it('caps streams per user', () => {
    const live = new LiveViewersService();
    const rel = Array.from({ length: MAX_STREAMS_PER_USER }, () => live.acquireUser('u')!);
    expect(rel.every(Boolean)).toBe(true);
    expect(live.acquireUser('u')).toBeNull();
    expect(live.acquireUser('v')).not.toBeNull();
    rel[0]();
    expect(live.acquireUser('u')).not.toBeNull();
  });
});

describe('nextInterval', () => {
  it('unclaimed device -> UNCLAIMED_PING_INTERVAL_SEC (30), even when the farm id is unknown', async () => {
    const a = setup({}, { farmId: null, farm: null, animal: null });
    a.live.join('f1'); // a watched farm does not matter for an unclaimed device
    expect((await a.svc.processDeviceTelemetry(a.device, ping())).nextInterval).toBe(30);
    const b = setup({ UNCLAIMED_PING_INTERVAL_SEC: '45' }, { farmId: null, farm: null, animal: null });
    expect((await b.svc.processDeviceTelemetry(b.device, ping())).nextInterval).toBe(45);
  });

  it('claimed, nobody watching -> normal (300); a viewer -> live (1); after it left -> still live until the linger ends', async () => {
    useFakeDate();
    const { svc, live, device } = setup();
    let t = Date.now();
    live.now = () => t;
    expect((await svc.processDeviceTelemetry(device, ping())).nextInterval).toBe(300);
    const leave = live.join('f1');
    expect((await svc.processDeviceTelemetry(device, ping())).nextInterval).toBe(1);
    leave();
    t += 100_000;
    expect((await svc.processDeviceTelemetry(device, ping())).nextInterval).toBe(1);
    t += 30_000;
    expect((await svc.processDeviceTelemetry(device, ping())).nextInterval).toBe(300);
  });

  it('another farm being watched does not make this one live', async () => {
    const { svc, live, device } = setup();
    live.join('other-farm');
    expect((await svc.processDeviceTelemetry(device, ping())).nextInterval).toBe(300);
  });

  it('LIVE_PING_INTERVAL_SEC is honoured and clamped to 1..60', async () => {
    const a = setup({ LIVE_PING_INTERVAL_SEC: '5' });
    a.live.join('f1');
    expect((await a.svc.processDeviceTelemetry(a.device, ping())).nextInterval).toBe(5);
    const b = setup({ LIVE_PING_INTERVAL_SEC: '500' });
    b.live.join('f1');
    expect((await b.svc.processDeviceTelemetry(b.device, ping())).nextInterval).toBe(60);
  });

  it('outside: emergency 60 s when not live, never longer than the live interval when live', async () => {
    const quiet = setup();
    expect((await quiet.svc.processDeviceTelemetry(quiet.device, ping(RED))).nextInterval).toBe(60);
    const watched = setup();
    watched.live.join('f1');
    expect((await watched.svc.processDeviceTelemetry(watched.device, ping(RED))).nextInterval).toBe(1);
    const slowLive = setup({ LIVE_PING_INTERVAL_SEC: '60', EMERGENCY_PING_INTERVAL_SEC: '20' });
    slowLive.live.join('f1');
    expect((await slowLive.svc.processDeviceTelemetry(slowLive.device, ping(RED))).nextInterval).toBe(20);
  });
});

describe('streaming', () => {
  it('only events of the requested farm are streamed; unclaimed devices never', async () => {
    const f1 = setup();
    const f2 = setup({}, { farmId: 'f2', deviceId: 'QAM-0002', code: '00000002' });
    f2.svc = f1.svc; // same service, two farms
    const unclaimed = setup({}, { farmId: null, farm: null, animal: null, deviceId: 'QAM-0003', code: '00000003' });
    const got: any[] = [];
    const sub = f1.svc.getTelemetryStream('f1').subscribe((e) => got.push(e));
    await f1.svc.processDeviceTelemetry(f1.device, ping());
    await f1.svc.processDeviceTelemetry(f2.device, { ...ping(), deviceId: 'QAM-0002' });
    await f1.svc.processDeviceTelemetry(unclaimed.device, { ...ping(), deviceId: 'QAM-0003' });
    sub.unsubscribe();
    expect(got.map((e) => e.deviceId)).toEqual(['QAM-0001']);
    expect(got[0].farmId).toBe('f1');
  });

  it('openStream counts a live viewer until unsubscribe, emits keepalive first, hides farmId, enforces the cap', () => {
    const { svc, live } = setup();
    const events: any[] = [];
    const sub = svc.openStream({ userId: 'u', farmId: 'f1' }).subscribe((e) => events.push(e));
    expect(live.viewerCount('f1')).toBe(1);
    expect(live.userStreams('u')).toBe(1);
    expect(events[0].data.type).toBe('keepalive');
    sub.unsubscribe();
    expect(live.viewerCount('f1')).toBe(0);
    expect(live.userStreams('u')).toBe(0);
    expect(live.isLive('f1', 120)).toBe(true); // lingers

    const subs = Array.from({ length: MAX_STREAMS_PER_USER }, () => svc.openStream({ userId: 'u', farmId: 'f1' }).subscribe());
    expect(() => svc.openStream({ userId: 'u', farmId: 'f1' })).toThrow(expect.objectContaining({ status: 429 }));
    subs.forEach((s) => s.unsubscribe());
  });

  it('the stream payload does not carry farmId', async () => {
    const { svc, device } = setup();
    const events: any[] = [];
    const sub = svc.openStream({ userId: 'u', farmId: 'f1' }).subscribe((e) => events.push(e));
    await svc.processDeviceTelemetry(device, ping());
    sub.unsubscribe();
    const t = events.find((e) => e.data.type === 'telemetry');
    expect(t.data).toMatchObject({ deviceId: 'QAM-0001', zone: 'GREEN' });
    expect(t.data).not.toHaveProperty('farmId');
  });

  it('pulseThreat: a stored pulse older than 120 s is not broadcast as current', async () => {
    useFakeDate();
    const fresh = setup({}, {}, { lastHeartRate: 70, lastHeartRateAt: new Date(Date.now() - 100_000) });
    const old = setup({}, {}, { lastHeartRate: 70, lastHeartRateAt: new Date(Date.now() - 121_000) });
    const out: any[] = [];
    for (const s of [fresh, old]) {
      const sub = s.svc.getTelemetryStream('f1').subscribe((e) => out.push(e));
      await s.svc.processDeviceTelemetry(s.device, ping());
      sub.unsubscribe();
    }
    expect(out[0].heartRate).toBe(70);
    expect(out[0].pulseThreat.level).not.toBe('UNKNOWN');
    expect(out[1].heartRate).toBeNull();
    expect(out[1].lastHeartRateAt).toBeNull();
    expect(out[1].pulseThreat.level).toBe('UNKNOWN');
  });
});

describe('write volume per ping', () => {
  it('a Telemetry row is stored at most every TELEMETRY_STORE_MIN_SEC, the stream is broadcast on every ping', async () => {
    useFakeDate();
    const { svc, prisma, device } = setup();
    const seen: any[] = [];
    svc.getTelemetryStream('f1').subscribe((e) => seen.push(e));
    await svc.processDeviceTelemetry(device, ping());
    for (let i = 0; i < 5; i++) {
      jest.setSystemTime(Date.now() + 1000);
      await svc.processDeviceTelemetry(device, ping());
    }
    expect(prisma.telemetry.create).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(6);
    jest.setSystemTime(Date.now() + 10_000);
    await svc.processDeviceTelemetry(device, ping());
    expect(prisma.telemetry.create).toHaveBeenCalledTimes(2);
  });

  it('a zone change, a breach and a pulse that appears are stored at once', async () => {
    useFakeDate();
    const { svc, prisma, device } = setup();
    await svc.processDeviceTelemetry(device, ping());
    jest.setSystemTime(Date.now() + 1000);
    await svc.processDeviceTelemetry(device, ping());
    expect(prisma.telemetry.create).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + 1000);
    await svc.processDeviceTelemetry(device, ping(RED)); // zone change + breach
    expect(prisma.telemetry.create).toHaveBeenCalledTimes(2);
    device.animal.isOutsideGeofence = true; // what the animal row holds after the breach ping
    jest.setSystemTime(Date.now() + 1000);
    await svc.processDeviceTelemetry(device, ping(RED, { heartRate: 70 })); // pulse appears
    expect(prisma.telemetry.create).toHaveBeenCalledTimes(3);
    jest.setSystemTime(Date.now() + 1000);
    await svc.processDeviceTelemetry(device, ping(RED, { heartRate: 71 })); // pulse continues, same zone
    expect(prisma.telemetry.create).toHaveBeenCalledTimes(3);
  });

  it('TELEMETRY_STORE_MIN_SEC=0 stores every ping', async () => {
    useFakeDate();
    const { svc, prisma, device } = setup({ TELEMETRY_STORE_MIN_SEC: '0' });
    for (let i = 0; i < 3; i++) {
      jest.setSystemTime(Date.now() + 1000);
      await svc.processDeviceTelemetry(device, ping());
    }
    expect(prisma.telemetry.create).toHaveBeenCalledTimes(3);
  });

  it('the device row is rewritten only on a status change or after 10 s', async () => {
    useFakeDate();
    const { svc, prisma, device } = setup();
    device.lastHeartbeatAt = new Date(Date.now() - 2000);
    await svc.processDeviceTelemetry(device, ping());
    expect(prisma.device.update).not.toHaveBeenCalled();
    device.lastHeartbeatAt = new Date(Date.now() - 11_000);
    await svc.processDeviceTelemetry(device, ping());
    expect(prisma.device.update).toHaveBeenCalledTimes(1);
    device.status = 'OFFLINE';
    device.lastHeartbeatAt = new Date();
    await svc.processDeviceTelemetry(device, ping());
    expect(prisma.device.update).toHaveBeenCalledTimes(2);
    expect(prisma.device.update.mock.calls[1][0].data.status).toBe('ONLINE');
  });

  it('restoreDevice only for a device that was OFFLINE (or silent past the offline threshold)', async () => {
    useFakeDate();
    const online = setup();
    await online.svc.processDeviceTelemetry(online.device, ping());
    expect(online.alerts.restoreDevice).not.toHaveBeenCalled();
    const off = setup({}, { status: 'OFFLINE' });
    await off.svc.processDeviceTelemetry(off.device, ping());
    expect(off.alerts.restoreDevice).toHaveBeenCalledTimes(1);
    const silent = setup({}, { lastHeartbeatAt: new Date(Date.now() - 1000_000) });
    await silent.svc.processDeviceTelemetry(silent.device, ping());
    expect(silent.alerts.restoreDevice).toHaveBeenCalledTimes(1);
  });

  it('resolveGpsLost only when a GPS_LOST could be open; breach lookups are throttled while outside', async () => {
    useFakeDate();
    const { svc, alerts, device } = setup();
    await svc.processDeviceTelemetry(device, ping()); // first ping: nothing known -> checked once
    expect(alerts.resolveGpsLost).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) {
      jest.setSystemTime(Date.now() + 1000);
      await svc.processDeviceTelemetry(device, ping());
    }
    expect(alerts.resolveGpsLost).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + 1000);
    await svc.processDeviceTelemetry(device, ping(GREEN, { accuracy: 999 })); // lost
    jest.setSystemTime(Date.now() + 1000);
    await svc.processDeviceTelemetry(device, ping()); // back -> closes it
    expect(alerts.resolveGpsLost).toHaveBeenCalledTimes(2);

    // outside: one breach lookup, then at most one per 15 s
    device.animal.isOutsideGeofence = true;
    alerts.triggerGeofenceBreach.mockClear();
    for (let i = 0; i < 5; i++) {
      jest.setSystemTime(Date.now() + 1000);
      await svc.processDeviceTelemetry(device, ping(RED));
    }
    expect(alerts.triggerGeofenceBreach.mock.calls.length).toBeLessThanOrEqual(1);
    jest.setSystemTime(Date.now() + 20_000);
    await svc.processDeviceTelemetry(device, ping(RED));
    expect(alerts.triggerGeofenceBreach).toHaveBeenCalled();
    expect(alerts.triggerGeofenceBreach.mock.calls.at(-1)![0].freshBreach).toBe(false);
  });

  it('a fresh crossing is marked freshBreach', async () => {
    const { svc, alerts, device } = setup();
    await svc.processDeviceTelemetry(device, ping(RED));
    expect(alerts.triggerGeofenceBreach.mock.calls[0][0].freshBreach).toBe(true);
  });
});

describe('E. unreliable fix', () => {
  it('raises GPS_LOST but keeps the animal position and lastSeenAt; the pulse is still stored', async () => {
    const { svc, prisma, alerts, device } = setup();
    await svc.processDeviceTelemetry(device, ping(GREEN, { accuracy: 999, heartRate: 66 }));
    expect(alerts.triggerGpsLost).toHaveBeenCalled();
    expect(prisma.animal.update).toHaveBeenCalledTimes(1);
    const data = prisma.animal.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ lastHeartRate: 66 });
    for (const k of ['lastLatitude', 'lastLongitude', 'lastAccuracy', 'lastSeenAt', 'isOutsideGeofence']) expect(data).not.toHaveProperty(k);
  });

  it('without a pulse the animal row is not touched at all', async () => {
    const { svc, prisma, device } = setup();
    await svc.processDeviceTelemetry(device, ping(GREEN, { accuracy: 999 }));
    expect(prisma.animal.update).not.toHaveBeenCalled();
  });
});

describe('C. episodic signals (SignalsService)', () => {
  function world(over: { used?: number; last?: Date | null } = {}) {
    const events: any[] = [];
    const prisma: any = {
      signalLimit: { findMany: jest.fn(async () => [{ level: 'SOUND', dailyLimit: 3, unlimited: false }]) },
      signalEvent: {
        findFirst: jest.fn(async () => (over.last ? { at: over.last } : null)),
        count: jest.fn(async () => over.used ?? 0),
        createMany: jest.fn(async ({ data }: any) => { events.push(...data); }),
      },
      alert: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => data) },
    };
    return { svc: new SignalsService(prisma, new AlertsService(prisma)), prisma, events };
  }
  const args = (now: Date, over: any = {}) => ({
    farmId: 'F', timezone: 'Asia/Aqtau', animal: { id: 'a1', name: 'A' }, deviceId: 'Q', sound: true, vibrate: true, now, ...over,
  });
  const T = new Date(Date.UTC(2026, 10, 9, 8, 0, 0));
  const plus = (s: number) => new Date(T.getTime() + s * 1000);

  it('one signal per kind per 30 s; inside the cooldown nothing is delivered, recorded or counted, not a suppression', async () => {
    const { svc, prisma, events } = world();
    expect(await svc.applyLimits(args(T))).toEqual({ sound: true, vibrate: true, suppressed: false });
    expect(events.map((e) => e.level)).toEqual(['SOUND', 'VIBRATION']);
    prisma.signalEvent.count.mockClear();
    for (let s = 1; s < 30; s += 4) {
      expect(await svc.applyLimits(args(plus(s)))).toEqual({ sound: false, vibrate: false, suppressed: false });
    }
    expect(events).toHaveLength(2);
    expect(prisma.signalEvent.count).not.toHaveBeenCalled();
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(await svc.applyLimits(args(plus(30)))).toEqual({ sound: true, vibrate: true, suppressed: false });
    expect(events).toHaveLength(4);
  });

  it('kinds are independent', async () => {
    const { svc } = world();
    await svc.applyLimits(args(T, { vibrate: false }));
    expect(await svc.applyLimits(args(plus(5), { sound: true, vibrate: true }))).toEqual({ sound: false, vibrate: true, suppressed: false });
  });

  it('DB-backed after a restart: the latest SignalEvent starts the cooldown', async () => {
    const { svc, prisma } = world({ last: plus(-10) });
    expect(await svc.applyLimits(args(T))).toEqual({ sound: false, vibrate: false, suppressed: false });
    expect(prisma.signalEvent.findFirst.mock.calls[0][0]).toMatchObject({ where: { animalId: 'a1' }, orderBy: { at: 'desc' } });
    expect(prisma.signalEvent.createMany).not.toHaveBeenCalled();
  });

  it('after the cooldown the daily limit still applies (and is a suppression)', async () => {
    const { svc } = world({ used: 3 });
    expect(await svc.applyLimits(args(T, { vibrate: false }))).toEqual({ sound: false, vibrate: false, suppressed: true });
  });

  it('cooldownSec=0 switches the cooldown off', async () => {
    const { svc } = world();
    await svc.applyLimits(args(T, { cooldownSec: 0 }));
    expect((await svc.applyLimits(args(plus(1), { cooldownSec: 0 }))).sound).toBe(true);
  });

  it('TelemetryService: stale and retried pings never deliver or record a signal', async () => {
    const stale = setup({}, {}, { lastSeenAt: new Date(Date.now() + 1000) });
    const r1: any = await stale.svc.processDeviceTelemetry(stale.device, ping(RED, { timestamp: new Date().toISOString() }));
    expect(r1).toMatchObject({ zone: 'RED', sound: false, vibrate: false, toneFrequencyHz: 0, suppressedBy: null });
    expect(stale.signals.applyLimits).not.toHaveBeenCalled();
    const dup = setup();
    dup.prisma.telemetry.findFirst.mockResolvedValue({ id: 't' });
    const r2: any = await dup.svc.processDeviceTelemetry(dup.device, ping(RED));
    expect(r2).toMatchObject({ sound: false, vibrate: false });
    expect(dup.signals.applyLimits).not.toHaveBeenCalled();
  });

  it('TelemetryService passes the cooldown to applyLimits and keeps suppressedBy null inside it', async () => {
    const { svc, signals, device } = setup({ SIGNAL_COOLDOWN_SEC: '45' });
    signals.applyLimits.mockResolvedValue({ sound: false, vibrate: false, suppressed: false });
    const r: any = await svc.processDeviceTelemetry(device, ping(RED));
    expect(signals.applyLimits).toHaveBeenCalledWith(expect.objectContaining({ cooldownSec: 45, record: true }));
    expect(r).toMatchObject({ zone: 'RED', sound: false, vibrate: false, toneFrequencyHz: 0, suppressedBy: null });
  });
});

describe('G. a user-resolved breach alert is not re-raised at once', () => {
  function world(resolved: any[]) {
    const prisma: any = {
      alert: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.dedupeKey) return null; // nothing open
          return resolved.find((a) => a.resolvedAt >= where.resolvedAt.gte) ?? null;
        }),
        create: jest.fn(async ({ data }: any) => data),
      },
    };
    return { prisma, svc: new AlertsService(prisma) };
  }
  const breach = { farmId: 'F', animalId: 'a1', animalName: 'A', deviceId: 'Q', latitude: 1, longitude: 2 };

  it('resolved 5 min ago and still outside -> no new alert; resolved 11 min ago -> new alert', async () => {
    const recent = world([{ resolvedAt: new Date(Date.now() - 5 * 60_000) }]);
    expect(await recent.svc.triggerGeofenceBreach(breach)).toBeNull();
    expect(recent.prisma.alert.create).not.toHaveBeenCalled();
    const old = world([{ resolvedAt: new Date(Date.now() - 11 * 60_000) }]);
    await old.svc.triggerGeofenceBreach(breach);
    expect(old.prisma.alert.create).toHaveBeenCalledTimes(1);
  });

  it('a fresh crossing (freshBreach) is always raised', async () => {
    const recent = world([{ resolvedAt: new Date(Date.now() - 60_000) }]);
    await recent.svc.triggerGeofenceBreach({ ...breach, freshBreach: true });
    expect(recent.prisma.alert.create).toHaveBeenCalledTimes(1);
  });
});

describe('I. changing the collar resolves the old collar alerts', () => {
  function world(currentDevice: string | null) {
    const prisma: any = {
      animal: {
        findFirst: jest.fn(async () => ({ id: 'a1', farmId: 'F', tagNumber: 't', species: 'CATTLE', gender: 'UNKNOWN', isDemo: false, device: null, alerts: [] })),
        count: jest.fn(async () => 1), update: jest.fn(),
      },
      device: {
        count: jest.fn(async () => 1),
        findFirst: jest.fn(async () => (currentDevice ? { deviceId: currentDevice } : null)),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      alert: { updateMany: jest.fn(async () => ({ count: 1 })) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    return { prisma, svc: new AnimalsService(prisma) };
  }

  it('swapping to another collar resolves DEVICE_OFFLINE / GPS_LOST of the animal', async () => {
    const { prisma, svc } = world('QAM-OLD');
    await svc.updateAnimal('u', 'F', 'a1', { collarId: 'QAM-NEW' } as any);
    expect(prisma.alert.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.alert.updateMany.mock.calls[0][0].where.type.in.sort()).toEqual(['DEVICE_OFFLINE', 'GPS_LOST']);
    expect(prisma.alert.updateMany.mock.invocationCallOrder[0]).toBeLessThan(prisma.device.updateMany.mock.invocationCallOrder[0]);
  });

  it('removing the collar (null) resolves them too; re-sending the same collar or a field-only edit does not', async () => {
    const a = world('QAM-OLD');
    await a.svc.updateAnimal('u', 'F', 'a1', { collarId: null } as any);
    expect(a.prisma.alert.updateMany).toHaveBeenCalledTimes(1);
    const b = world('QAM-OLD');
    await b.svc.updateAnimal('u', 'F', 'a1', { collarId: 'QAM-OLD' } as any);
    expect(b.prisma.alert.updateMany).not.toHaveBeenCalled();
    const c = world('QAM-OLD');
    await c.svc.updateAnimal('u', 'F', 'a1', { name: 'X' } as any);
    expect(c.prisma.alert.updateMany).not.toHaveBeenCalled();
  });
});

describe('F. claiming a device is rate limited; H. rotate-secret is gone', () => {
  it('POST /devices carries per-user (10/min, 60/h) and per-IP rules', () => {
    const meta = Reflect.getMetadata(RATE_LIMIT_KEY, DevicesController.prototype.registerDevice);
    expect(meta.name).toBe('device-claim');
    expect(meta.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ limit: 10, windowMs: 60_000, perUser: true }),
        expect.objectContaining({ limit: 60, windowMs: 3_600_000, perUser: true }),
        expect.objectContaining({ limit: 30, windowMs: 60_000 }),
      ]),
    );
    const guards: any[] = Reflect.getMetadata('__guards__', DevicesController.prototype.registerDevice);
    expect(guards).toContain(RateLimitGuard);
  });

  it('the guard limits per user, independent of the IP', () => {
    const { Reflector } = require('@nestjs/core');
    const guard = new RateLimitGuard(new Reflector(), new RateLimiterService());
    const ctx = (userId: string, ip: string): any => ({
      getHandler: () => DevicesController.prototype.registerDevice,
      switchToHttp: () => ({ getRequest: () => ({ ip, user: { id: userId }, headers: {}, body: {} }) }),
    });
    for (let i = 0; i < 10; i++) expect(guard.canActivate(ctx('u1', `10.0.0.${i}`))).toBe(true);
    expect(() => guard.canActivate(ctx('u1', '10.0.1.1'))).toThrow(expect.objectContaining({ status: 429 }));
    expect(guard.canActivate(ctx('u2', '10.0.1.2'))).toBe(true);
  });

  it('no rotateSecret route or service method', () => {
    expect((DevicesController.prototype as any).rotateSecret).toBeUndefined();
    expect((DevicesService.prototype as any).rotateSecret).toBeUndefined();
  });
});

describe('env validation of the new variables', () => {
  const base = { DATABASE_URL: 'x', JWT_SECRET: 'a'.repeat(40) + 'Zq9' };
  it('accepts sane values and rejects bad ones', () => {
    expect(() => validateEnv({ ...base, LIVE_PING_INTERVAL_SEC: '1', LIVE_LINGER_SEC: '120', UNCLAIMED_PING_INTERVAL_SEC: '30', SIGNAL_COOLDOWN_SEC: '30', TELEMETRY_STORE_MIN_SEC: '0' })).not.toThrow();
    for (const [k, v] of [
      ['LIVE_PING_INTERVAL_SEC', '0'], ['LIVE_PING_INTERVAL_SEC', '61'], ['LIVE_PING_INTERVAL_SEC', 'x'],
      ['LIVE_LINGER_SEC', '-1'], ['UNCLAIMED_PING_INTERVAL_SEC', '0'], ['SIGNAL_COOLDOWN_SEC', '1.5'], ['TELEMETRY_STORE_MIN_SEC', 'abc'],
    ]) {
      expect(() => validateEnv({ ...base, [k]: v })).toThrow(new RegExp(k));
    }
  });
});
