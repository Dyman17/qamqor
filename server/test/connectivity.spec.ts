import { computeConnState, offlineThresholdMs } from '../src/devices/connectivity';
import { toCollarDto } from '../src/devices/devices.service';
import { dayWindow, tzOffsetMs } from '../src/common/farm-day';
import { loadAppConfig } from '../src/config/config';
import { OfflineWatcherService, OFFLINE_WATCHER_LOCK_KEY } from '../src/devices/offline-watcher.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { SignalsService } from '../src/signals/signals.service';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { GeofenceService } from '../src/geofences/geofence.service';
import { AnalyticsService } from '../src/analytics/analytics.service';

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const sec = (s: number) => new Date(NOW - s * 1000);

describe('config', () => {
  it('threshold = 3 missed pings x 300 s = 900 s by default; follows the env', () => {
    expect(loadAppConfig({}).offlineThresholdSec).toBe(900);
    expect(offlineThresholdMs({})).toBe(900_000);
    expect(loadAppConfig({ NORMAL_PING_INTERVAL_SEC: '60', OFFLINE_AFTER_MISSED_PINGS: '5' }).offlineThresholdSec).toBe(300);
  });
  it('scheduler is off under test', () => {
    expect(loadAppConfig({ NODE_ENV: 'test' }).schedulerEnabled).toBe(false);
    expect(loadAppConfig({ NODE_ENV: 'production' }).schedulerEnabled).toBe(true);
    expect(loadAppConfig({ NODE_ENV: 'production', SCHEDULER_ENABLED: 'false' }).schedulerEnabled).toBe(false);
  });
});

describe('computeConnState (fake clock)', () => {
  const th = 900_000;
  it('299 s ago -> ONLINE; 901 s ago -> OFFLINE; exactly 900 s -> still ONLINE', () => {
    expect(computeConnState({ hasAnimal: true, lastSeenAt: sec(299) }, NOW, th)).toBe('ONLINE');
    expect(computeConnState({ hasAnimal: true, lastSeenAt: sec(900) }, NOW, th)).toBe('ONLINE');
    expect(computeConnState({ hasAnimal: true, lastSeenAt: sec(901) }, NOW, th)).toBe('OFFLINE');
  });
  it('no animal -> UNASSIGNED whatever the ping time; assigned and never heard -> OFFLINE', () => {
    expect(computeConnState({ hasAnimal: false, lastSeenAt: sec(10) }, NOW, th)).toBe('UNASSIGNED');
    expect(computeConnState({ hasAnimal: false, lastSeenAt: null }, NOW, th)).toBe('UNASSIGNED');
    expect(computeConnState({ hasAnimal: true, lastSeenAt: null }, NOW, th)).toBe('OFFLINE');
  });
  it('the 15 s window is gone: a collar that pinged 5 min ago is ONLINE in the DTO', () => {
    const d = { deviceId: 'a', animal: { id: 'x', name: 'n' }, lastHeartbeatAt: new Date(Date.now() - 300_000) };
    expect(toCollarDto(d).status).toBe('ONLINE');
  });
});

describe('farm day boundaries (Asia/Aqtau = UTC+5)', () => {
  it('offset is +5 h', () => {
    expect(tzOffsetMs('Asia/Aqtau', NOW)).toBe(5 * 3600_000);
  });
  it('19:00 UTC is already the next local day (00:00 local)', () => {
    const before = dayWindow(new Date(Date.UTC(2026, 10, 8, 18, 59, 59)), 'Asia/Aqtau');
    const after = dayWindow(new Date(Date.UTC(2026, 10, 8, 19, 0, 0)), 'Asia/Aqtau');
    expect(before.day).toBe('2026-11-08');
    expect(after.day).toBe('2026-11-09');
    expect(before.start.toISOString()).toBe('2026-11-07T19:00:00.000Z');
    expect(before.end.toISOString()).toBe('2026-11-08T19:00:00.000Z');
    expect(after.start.toISOString()).toBe('2026-11-08T19:00:00.000Z');
  });
  it('other zones work and an unknown zone falls back to Aqtau', () => {
    expect(dayWindow(new Date(NOW), 'UTC').start.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(dayWindow(new Date(NOW), 'Not/AZone').day).toBe('2026-11-08');
  });
});

describe('OfflineWatcherService', () => {
  function world() {
    const alerts: any[] = [];
    const devices: any[] = [
      // silent for 20 min, has an animal
      { id: 'd1', deviceId: 'QAM-1', farmId: 'F', animalId: 'a1', lastHeartbeatAt: new Date(Date.now() - 20 * 60_000), animal: { id: 'a1', name: 'A' } },
    ];
    const inStatus = (w: any, st: string) => (w && typeof w === 'object' && w.in ? w.in.includes(st) : w === st);
    const impl = {
      findFirst: async ({ where }: any) =>
        alerts.find((a) => a.dedupeKey === where.dedupeKey && (where.status === undefined || inStatus(where.status, a.status))) ?? null,
      findMany: async ({ where }: any) =>
        alerts.filter((a) => where.dedupeKey.in.includes(a.dedupeKey) && inStatus(where.status, a.status)).map((a) => ({ dedupeKey: a.dedupeKey })),
      create: async ({ data }: any) => {
        if (alerts.some((a) => a.dedupeKey === data.dedupeKey && a.status === 'ACTIVE')) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: 'al' + alerts.length, ...data };
        alerts.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = alerts.filter((a) => a.animalId === where.animalId && a.type === where.type && inStatus(where.status, a.status));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    };
    const delegates = () => ({
      findFirst: jest.fn(impl.findFirst),
      findMany: jest.fn(impl.findMany),
      create: jest.fn(impl.create),
      updateMany: jest.fn(impl.updateMany),
    });
    const prisma: any = {
      alert: delegates(),
      device: { findMany: jest.fn(async () => devices) },
      $queryRaw: jest.fn(async () => [{ locked: true }]),
    };
    // The lock transaction gets its own client object so tests can see where writes go.
    const tx: any = {
      alert: delegates(),
      device: prisma.device,
      $queryRaw: (...a: any[]) => prisma.$queryRaw(...a),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(tx));
    return { prisma, tx, alerts, devices, watcher: new OfflineWatcherService(prisma, new AlertsService(prisma)) };
  }

  it('a silent collar gets exactly one ACTIVE DEVICE_OFFLINE; repeated runs do not duplicate', async () => {
    const { watcher, alerts } = world();
    await watcher.tick();
    await watcher.tick();
    await watcher.tick();
    expect(alerts.filter((a) => a.type === 'DEVICE_OFFLINE' && a.status === 'ACTIVE')).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ animalId: 'a1', farmId: 'F', dedupeKey: 'DEVICE_OFFLINE:a1' });
  });

  it('only collars older than the threshold are selected', async () => {
    const { watcher, prisma } = world();
    await watcher.tick(new Date());
    const where = prisma.device.findMany.mock.calls[0][0].where;
    expect(where.lastHeartbeatAt.lt).toBeInstanceOf(Date);
    expect(Date.now() - where.lastHeartbeatAt.lt.getTime()).toBeGreaterThanOrEqual(899_000);
    expect(where.animalId).toEqual({ not: null });
  });

  it('two watcher instances: the one without the advisory lock does nothing', async () => {
    const a = world();
    const b = world();
    b.prisma.$queryRaw.mockResolvedValue([{ locked: false }]);
    const [ra, rb] = await Promise.all([a.watcher.tick(), b.watcher.tick()]);
    expect(ra.locked).toBe(true);
    expect(rb).toEqual({ locked: false, stale: 0 });
    expect(b.alerts).toHaveLength(0);
    expect(a.alerts).toHaveLength(1);
    expect(OFFLINE_WATCHER_LOCK_KEY).toBeGreaterThan(0);
  });

  it('even if both instances somehow run, only one ACTIVE alert exists (the loser fails and retries next tick)', async () => {
    const w = world();
    const other = new OfflineWatcherService(w.prisma, new AlertsService(w.prisma));
    const res = await Promise.allSettled([w.watcher.tick(), other.tick()]);
    expect(w.alerts.filter((a) => a.status === 'ACTIVE')).toHaveLength(1);
    expect(res.filter((r) => r.status === 'rejected').length).toBeLessThanOrEqual(1);
  });

  it('is not started under test (no timer)', () => {
    const { watcher } = world();
    watcher.onModuleInit();
    expect((watcher as any).timer).toBeUndefined();
  });

  it('a ping closes the alert and creates DEVICE_RESTORED once', async () => {
    const { watcher, alerts, prisma } = world();
    await watcher.tick();
    const svc = new AlertsService(prisma);
    prisma.alert.create.mockImplementation(async ({ data }: any) => {
      const row = { id: 'r' + alerts.length, ...data };
      alerts.push(row);
      return row;
    });
    await svc.restoreDevice({ farmId: 'F', animalId: 'a1', animalName: 'A', deviceId: 'QAM-1' });
    await svc.restoreDevice({ farmId: 'F', animalId: 'a1', animalName: 'A', deviceId: 'QAM-1' });
    expect(alerts.filter((a) => a.type === 'DEVICE_OFFLINE')[0].status).toBe('RESOLVED');
    expect(alerts.filter((a) => a.type === 'DEVICE_RESTORED')).toHaveLength(1);
  });
});

describe('signal limits', () => {
  function world(limits: any[], used: Record<string, number>) {
    const alerts: any[] = [];
    const events: any[] = [];
    const prisma: any = {
      signalLimit: { findMany: jest.fn(async () => limits) },
      signalEvent: {
        count: jest.fn(async ({ where }: any) => used[where.level] ?? 0),
        createMany: jest.fn(async ({ data }: any) => { events.push(...data); }),
        groupBy: jest.fn(async () => Object.entries(used).map(([level, n]) => ({ level, _count: { _all: n } }))),
      },
      farm: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Aqtau' })) },
      alert: {
        findFirst: jest.fn(async ({ where }: any) => alerts.find((a) => a.dedupeKey === where.dedupeKey) ?? null),
        create: jest.fn(async ({ data }: any) => { alerts.push(data); return data; }),
      },
    };
    return { svc: new SignalsService(prisma, new AlertsService(prisma)), prisma, alerts, events };
  }
  const args = (over: any = {}) => ({
    farmId: 'F', timezone: 'Asia/Aqtau', animal: { id: 'a1', name: 'A' }, deviceId: 'QAM-1',
    sound: true, vibrate: false, now: new Date(Date.UTC(2026, 10, 8, 12)), ...over,
  });

  it('limit 2: the third sound of the day is suppressed with one SIGNAL_LIMIT_REACHED alert', async () => {
    const { svc, alerts, events } = world([{ level: 'SOUND', dailyLimit: 2, unlimited: false }], { SOUND: 2 });
    const r = await svc.applyLimits(args());
    expect(r).toEqual({ sound: false, vibrate: false, suppressed: true });
    expect(events).toHaveLength(0);
    // the same suppression again does not add a second alert for the day
    await svc.applyLimits(args());
    expect(alerts.filter((a) => a.type === 'SIGNAL_LIMIT_REACHED')).toHaveLength(1);
    expect(alerts[0].dedupeKey).toBe('SIGNAL_LIMIT_REACHED:a1:SOUND:2026-11-08');
  });

  it('under the limit: delivered and recorded', async () => {
    const { svc, events } = world([{ level: 'SOUND', dailyLimit: 2, unlimited: false }], { SOUND: 1 });
    expect(await svc.applyLimits(args())).toEqual({ sound: true, vibrate: false, suppressed: false });
    expect(events).toEqual([expect.objectContaining({ level: 'SOUND', animalId: 'a1' })]);
  });

  it('null (not set) and unlimited never suppress', async () => {
    for (const rows of [[], [{ level: 'SOUND', dailyLimit: null, unlimited: false }], [{ level: 'SOUND', dailyLimit: 1, unlimited: true }]]) {
      const { svc } = world(rows as any, { SOUND: 999 });
      expect((await svc.applyLimits(args())).suppressed).toBe(false);
    }
  });

  it('each level is limited independently', async () => {
    const { svc } = world([{ level: 'SOUND', dailyLimit: 1, unlimited: false }], { SOUND: 1 });
    expect(await svc.applyLimits(args({ sound: true, vibrate: true }))).toEqual({ sound: false, vibrate: true, suppressed: true });
  });

  it('the count window is the farm local day (Aqtau midnight = 19:00 UTC)', async () => {
    const { svc, prisma } = world([{ level: 'SOUND', dailyLimit: 5, unlimited: false }], {});
    await svc.applyLimits(args({ now: new Date(Date.UTC(2026, 10, 8, 18, 59)) }));
    await svc.applyLimits(args({ now: new Date(Date.UTC(2026, 10, 8, 19, 1)) }));
    const [first, second] = prisma.signalEvent.count.mock.calls.map((c: any) => c[0].where.at);
    expect(first.gte.toISOString()).toBe('2026-11-07T19:00:00.000Z');
    expect(second.gte.toISOString()).toBe('2026-11-08T19:00:00.000Z'); // counter restarts on the new local day
  });

  it('summary: impulse is never available', async () => {
    const { svc } = world([{ level: 'SOUND', dailyLimit: 3, unlimited: false }], { SOUND: 2, VIBRATION: 1 });
    expect(await svc.daySummary('F', 'a1', new Date(Date.UTC(2026, 10, 8, 12)))).toEqual({
      day: '2026-11-08',
      sound: { used: 2, limit: 3 },
      vibration: { used: 1, limit: null },
      impulse: { used: 0, limit: null, available: false },
    });
  });

  it('TelemetryService reports suppressedBy and silences the tone', async () => {
    const poly = { type: 'Polygon', coordinates: [[[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]] };
    const prisma: any = {
      animal: { update: jest.fn() }, device: { update: jest.fn() }, telemetry: { create: jest.fn(), findFirst: jest.fn(async () => null) },
      deviceCommand: { findFirst: jest.fn(async () => null), updateMany: jest.fn() },
    };
    const alerts: any = { triggerGeofenceBreach: jest.fn(), resolveGeofenceBreach: jest.fn(), resolveGpsLost: jest.fn(), restoreDevice: jest.fn() };
    const signals: any = { applyLimits: jest.fn(async () => ({ sound: false, vibrate: true, suppressed: true })) };
    const svc = new TelemetryService(prisma, new GeofenceService({} as any), alerts, { get: (_k: string, d: string) => d } as any, signals);
    const device: any = {
      id: 'd', deviceId: 'QAM-1', farmId: 'F', farm: { timezone: 'Asia/Aqtau' },
      animal: { id: 'a1', name: 'A', isOutsideGeofence: false, activeGeofence: { polygonJson: poly } },
    };
    const res: any = await svc.processDeviceTelemetry(device, {
      deviceId: 'QAM-1', timestamp: new Date().toISOString(), latitude: 43.6552, longitude: 51.157, accuracy: 5,
    } as any);
    expect(res).toMatchObject({ zone: 'RED', sound: false, vibrate: true, suppressedBy: 'SIGNAL_LIMIT', toneFrequencyHz: 0 });
    expect(signals.applyLimits).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Aqtau', sound: true, vibrate: true }));
    expect(alerts.restoreDevice).toHaveBeenCalled();
  });

  it('analytics: online devices counted from the last ping, not the stored status', async () => {
    const prisma: any = {
      alert: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      animal: { count: jest.fn(async () => 0), groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
      device: { count: jest.fn(async () => 0) },
    };
    await new AnalyticsService(prisma).getOverview('u', 'F');
    const calls = prisma.device.count.mock.calls.map((c: any) => c[0].where);
    expect(calls.some((w: any) => w.lastHeartbeatAt?.gte instanceof Date)).toBe(true);
    expect(calls.some((w: any) => 'status' in w)).toBe(false);
  });
});
