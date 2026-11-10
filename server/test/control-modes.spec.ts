import 'reflect-metadata';
import { ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Subject } from 'rxjs';
import {
  TelemetryService,
  zoneRank,
  COMMAND_REDELIVER_WINDOW_MS,
} from '../src/telemetry/telemetry.service';
import { CollarControlService } from '../src/telemetry/collar-control.service';
import { CollarControlController } from '../src/telemetry/collar-control.controller';
import { LiveViewersService } from '../src/telemetry/live-viewers.service';
import { GeofenceService } from '../src/geofences/geofence.service';
import { SignalsService } from '../src/signals/signals.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { OfflineWatcherService } from '../src/devices/offline-watcher.service';
import { ManualPositionDto, SetControlModeDto } from '../src/devices/dto/device.dto';
import { toCollarDto } from '../src/devices/devices.service';
import { toAnimalDto } from '../src/animals/mappers';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { RATE_LIMIT_KEY } from '../src/common/rate-limit';

const poly = {
  type: 'Polygon',
  coordinates: [[[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]],
};
const GREEN = 43.65;
const YELLOW = 43.65487; // ~14 m inside the northern border
const ORANGE = 43.654975; // ~3 m inside
const RED = 43.6552; // ~22 m outside
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

function setup(deviceOver: any = {}, animalOver: any = {}, env: Record<string, string> = {}) {
  const commands: any[] = [];
  const prisma: any = {
    animal: { update: jest.fn() },
    device: { update: jest.fn() },
    farmMember: { findUnique: jest.fn(async () => ({ farmId: 'f1' })) },
    telemetry: { create: jest.fn(), findFirst: jest.fn(async () => null) },
    deviceCommand: {
      findFirst: jest.fn(async () => commands.find((c) => c.status === 'PENDING') ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const c = commands.find((x) => x.id === where.id && x.status === where.status && (where.deliveryCount === undefined || x.deliveryCount === where.deliveryCount));
        if (!c) return { count: 0 };
        Object.assign(c, data);
        return { count: 1 };
      }),
    },
  };
  const alerts: any = {
    triggerGeofenceBreach: jest.fn(), resolveGeofenceBreach: jest.fn(), triggerGpsLost: jest.fn(),
    resolveGpsLost: jest.fn(), restoreDevice: jest.fn(),
  };
  const signals: any = { applyLimits: jest.fn(async (a: any) => ({ sound: a.sound, vibrate: a.vibrate, suppressed: false })) };
  const live = new LiveViewersService();
  const geofence = new GeofenceService({} as any);
  const config: any = { get: (k: string, d: string) => env[k] ?? d };
  const svc = new TelemetryService(prisma, geofence, alerts, config, signals, live);
  const device: any = {
    id: 'd1', deviceId: 'QAM-0001', code: '00000001', farmId: 'f1', status: 'ONLINE', isSimulated: false,
    lastHeartbeatAt: new Date(), farm: { timezone: 'Asia/Aqtau' }, controlMode: 'AUTO',
    manualLatitude: null, manualLongitude: null, controlActivityAt: new Date(),
    animal: { id: 'a1', name: 'A', species: 'CATTLE', isOutsideGeofence: false, activeGeofence: { polygonJson: poly }, ...animalOver },
    ...deviceOver,
  };
  return { svc, prisma, alerts, signals, live, device, geofence, commands };
}
const ping = (lat = GREEN, over: any = {}): any => ({
  deviceId: 'QAM-0001', timestamp: new Date().toISOString(), latitude: lat, longitude: LNG, accuracy: 5, ...over,
});
const tick = (ms = 1000) => jest.setSystemTime(Date.now() + ms);

describe('PART 1.1 SSE ends on JWT expiry and when membership is lost', () => {
  it('completes at the JWT exp and releases the viewer and the stream slot', async () => {
    useFakeDate();
    const { svc, live } = setup();
    let done = false;
    const exp = Math.floor(Date.now() / 1000) + 60;
    svc.openStream({ userId: 'u', farmId: 'f1', expiresAtSec: exp }).subscribe({ complete: () => (done = true) });
    expect(live.viewerCount('f1')).toBe(1);
    await jest.advanceTimersByTimeAsync(59_000);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(true);
    expect(live.viewerCount('f1')).toBe(0);
    expect(live.userStreams('u')).toBe(0);
  });

  it('an already expired token ends at once', async () => {
    useFakeDate();
    const { svc, live } = setup();
    let done = false;
    svc.openStream({ userId: 'u', farmId: 'f1', expiresAtSec: Math.floor(Date.now() / 1000) - 5 }).subscribe({ complete: () => (done = true) });
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(live.userStreams('u')).toBe(0);
  });

  it('keepalive tick re-checks membership: a member keeps the stream, a removed user is completed and released', async () => {
    useFakeDate();
    const { svc, live, prisma } = setup();
    const events: any[] = [];
    let done = false;
    svc.openStream({ userId: 'u', farmId: 'f1' }).subscribe({ next: (e) => events.push(e), complete: () => (done = true) });
    expect(events).toHaveLength(1); // the immediate keepalive
    await jest.advanceTimersByTimeAsync(15_000);
    expect(prisma.farmMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_farmId: { userId: 'u', farmId: 'f1' } } }));
    expect(events).toHaveLength(2);
    expect(done).toBe(false);

    prisma.farmMember.findUnique.mockResolvedValue(null);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(done).toBe(true);
    expect(events).toHaveLength(2); // no further keepalive for a non-member
    expect(live.viewerCount('f1')).toBe(0);
    expect(live.userStreams('u')).toBe(0);
  });

  it('a database error in the membership check does not end the stream', async () => {
    useFakeDate();
    const { svc, prisma } = setup();
    prisma.farmMember.findUnique.mockRejectedValue(new Error('db down'));
    let done = false;
    const events: any[] = [];
    const sub = svc.openStream({ userId: 'u', farmId: 'f1' }).subscribe({ next: (e) => events.push(e), complete: () => (done = true) });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(done).toBe(false);
    expect(events).toHaveLength(2);
    sub.unsubscribe();
  });

  it('JwtStrategy hands the token expiry to the request user', async () => {
    const prisma: any = { user: { findUnique: jest.fn(async () => ({ id: 'u', email: 'e', fullName: 'n', passwordChangedAt: null })) } };
    const strat = new JwtStrategy({ getOrThrow: () => 'x'.repeat(48) } as any, prisma);
    expect(await strat.validate({ sub: 'u', email: 'e', iat: 1, exp: 12345 })).toMatchObject({ id: 'u', tokenExp: 12345 });
  });
});

describe('PART 1.2 GPS_LOST is closed by any fresh reliable fix', () => {
  it('accuracy 999 -> good fix without a boundary -> good fix with a boundary leaves nothing open', async () => {
    useFakeDate();
    const { svc, alerts, device } = setup();
    await svc.processDeviceTelemetry(device, ping(GREEN)); // first ping: checked once
    expect(alerts.resolveGpsLost).toHaveBeenCalledTimes(1);
    tick();
    await svc.processDeviceTelemetry(device, ping(GREEN, { accuracy: 999 })); // lost
    expect(alerts.triggerGpsLost).toHaveBeenCalledTimes(1);
    tick();
    const saved = device.animal.activeGeofence;
    device.animal.activeGeofence = null; // good fix, but the animal has no boundary: zone UNKNOWN / NO_BOUNDARY
    const r: any = await svc.processDeviceTelemetry(device, ping(GREEN));
    expect(r.zone).toBe('UNKNOWN');
    expect(alerts.resolveGpsLost).toHaveBeenCalledTimes(2); // closed here already
    tick();
    device.animal.activeGeofence = saved;
    await svc.processDeviceTelemetry(device, ping(GREEN));
    expect(alerts.resolveGpsLost).toHaveBeenCalledTimes(2); // and not looked up again
  });

  it('an unreliable fix keeps the flag set, a fix that is still unreliable does not close it', async () => {
    useFakeDate();
    const { svc, alerts, device } = setup();
    await svc.processDeviceTelemetry(device, ping(GREEN));
    for (let i = 0; i < 3; i++) {
      tick();
      await svc.processDeviceTelemetry(device, ping(GREEN, { accuracy: 999 }));
    }
    expect(alerts.resolveGpsLost).toHaveBeenCalledTimes(1);
    tick();
    await svc.processDeviceTelemetry(device, ping(GREEN));
    expect(alerts.resolveGpsLost).toHaveBeenCalledTimes(2);
  });

  it('a no-fix (pulse-only) ping in between changes nothing', async () => {
    useFakeDate();
    const { svc, alerts, device } = setup();
    await svc.processDeviceTelemetry(device, ping(GREEN, { accuracy: 999 }));
    tick();
    await svc.processDeviceTelemetry(device, { deviceId: 'QAM-0001', heartRate: 70 } as any);
    tick();
    await svc.processDeviceTelemetry(device, ping(GREEN));
    expect(alerts.resolveGpsLost).toHaveBeenCalledTimes(1);
  });
});

describe('PART 1.4 offline watcher does not overwrite a newer heartbeat', () => {
  it('the OFFLINE update is guarded with lastHeartbeatAt < cutoff', async () => {
    const devices = [
      { id: 'd1', deviceId: 'QAM-1', farmId: 'F', animalId: 'a1', lastHeartbeatAt: new Date(Date.now() - 20 * 60_000), animal: { id: 'a1', name: 'A', isDemo: false } },
    ];
    const tx: any = {
      $queryRaw: jest.fn(async () => [{ locked: true }]),
      device: { findMany: jest.fn(async () => devices), updateMany: jest.fn(async () => ({ count: 1 })) },
      alert: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => data) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const watcher = new OfflineWatcherService(prisma, new AlertsService(prisma));
    const now = new Date();
    await watcher.tick(now);
    const where = tx.device.updateMany.mock.calls[0][0].where;
    expect(where.lastHeartbeatAt.lt).toBeInstanceOf(Date);
    expect(where.lastHeartbeatAt.lt.getTime()).toBeLessThan(now.getTime());
    expect(where).toMatchObject({ id: { in: ['d1'] }, status: { not: 'OFFLINE' } });
  });
});

describe('PART 2 control modes in the telemetry reply', () => {
  it('AUTO (default, also an unknown value or a simulated collar) behaves as before', async () => {
    const a = setup();
    expect(await a.svc.processDeviceTelemetry(a.device, ping(RED))).toMatchObject({ zone: 'RED', sound: true, vibrate: true, controlMode: 'AUTO' });
    const sim = setup({ isSimulated: true, controlMode: 'MANUAL' });
    expect(await sim.svc.processDeviceTelemetry(sim.device, ping(RED))).toMatchObject({ zone: 'RED', sound: true, controlMode: 'AUTO' });
  });

  it('MANUAL: real GPS is shown and alerts work, but no automatic signal is produced or recorded', async () => {
    const { svc, prisma, signals, alerts, device } = setup({ controlMode: 'MANUAL' });
    const events: any[] = [];
    svc.getTelemetryStream('f1').subscribe((e) => events.push(e));
    const r: any = await svc.processDeviceTelemetry(device, ping(RED));
    expect(r).toMatchObject({ zone: 'RED', sound: false, vibrate: false, toneFrequencyHz: 0, vibrateDurationMs: 0, controlMode: 'MANUAL' });
    expect(r.warningMessage).toMatch(/MANUAL/);
    expect(signals.applyLimits).not.toHaveBeenCalled();
    expect(alerts.triggerGeofenceBreach).toHaveBeenCalledTimes(1);
    expect(prisma.animal.update.mock.calls[0][0].data).toMatchObject({ lastLatitude: RED, isOutsideGeofence: true });
    expect(events[0]).toMatchObject({ latitude: RED, positionSource: 'GPS', controlMode: 'MANUAL', sound: false, vibrate: false });
  });

  it('MANUAL: the operator command still reaches the ESP', async () => {
    const { svc, device, commands } = setup({ controlMode: 'MANUAL' });
    commands.push({ id: 'c1', command: 'TEST_BUZZER', status: 'PENDING', deliveryCount: 0, deliveredAt: null });
    const r: any = await svc.processDeviceTelemetry(device, ping(GREEN));
    expect(r.command).toEqual({ id: 'c1', type: 'TEST_BUZZER' });
  });

  it('GPS_MANUAL: zone, alerts and signals come from the manual point; the real GPS only lands in the telemetry row', async () => {
    useFakeDate();
    const { svc, prisma, signals, alerts, geofence, device } = setup({ controlMode: 'GPS_MANUAL', manualLatitude: YELLOW, manualLongitude: LNG });
    const spy = jest.spyOn(geofence, 'evaluateLocation');
    const events: any[] = [];
    svc.getTelemetryStream('f1').subscribe((e) => events.push(e));
    // the collar sits far outside with a 20 km/h speed; that must not matter
    const r: any = await svc.processDeviceTelemetry(device, ping(RED, { speedKmh: 20, heartRate: 71 }));
    expect(spy.mock.calls[0][0]).toEqual({ latitude: YELLOW, longitude: LNG, accuracy: 0, speed: 0 });
    expect(r).toMatchObject({ zone: 'YELLOW', sound: true, vibrate: false, inFence: true, controlMode: 'GPS_MANUAL' });
    expect(signals.applyLimits).toHaveBeenCalledTimes(1);
    expect(alerts.triggerGeofenceBreach).not.toHaveBeenCalled();
    // the animal does not move to the real fix; the pulse is kept
    const data = prisma.animal.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ lastHeartRate: 71 });
    for (const k of ['lastLatitude', 'lastLongitude', 'lastAccuracy', 'lastSeenAt']) expect(data).not.toHaveProperty(k);
    // the real GPS is stored
    expect(prisma.telemetry.create.mock.calls[0][0].data).toMatchObject({ latitude: RED, longitude: LNG, accuracy: 5, heartRate: 71 });
    expect(events[0]).toMatchObject({ latitude: YELLOW, longitude: LNG, accuracyM: 0, positionSource: 'MANUAL', zone: 'YELLOW', heartRate: 71 });
  });

  it('GPS_MANUAL: a manual point outside raises the breach with the manual coordinates; ESCAPE needs speed 0 -> RED', async () => {
    const { svc, alerts, device } = setup({ controlMode: 'GPS_MANUAL', manualLatitude: RED, manualLongitude: LNG });
    const r: any = await svc.processDeviceTelemetry(device, ping(GREEN, { speedKmh: 40 }));
    expect(r).toMatchObject({ zone: 'RED', sound: true, vibrate: true });
    expect(alerts.triggerGeofenceBreach.mock.calls[0][0]).toMatchObject({ latitude: RED, longitude: LNG });
  });

  it('GPS_MANUAL: bad real accuracy raises no GPS alert; no stale rejection although the animal row is "newer"', async () => {
    const { svc, alerts, device } = setup(
      { controlMode: 'GPS_MANUAL', manualLatitude: ORANGE, manualLongitude: LNG },
      { lastSeenAt: new Date(Date.now() + 60_000) },
    );
    const r: any = await svc.processDeviceTelemetry(device, ping(GREEN, { accuracy: 999 }));
    expect(r).toMatchObject({ zone: 'ORANGE', sound: true, vibrate: true });
    expect(alerts.triggerGpsLost).not.toHaveBeenCalled();
    expect(alerts.resolveGpsLost).not.toHaveBeenCalled();
  });

  it('GPS_MANUAL without a manual position: zone UNKNOWN, no signals, pulse still stored, real GPS stored', async () => {
    const { svc, prisma, signals, device } = setup({ controlMode: 'GPS_MANUAL' });
    const r: any = await svc.processDeviceTelemetry(device, ping(RED, { heartRate: 66 }));
    expect(r).toMatchObject({ zone: 'UNKNOWN', sound: false, vibrate: false, inFence: null });
    expect(r.warningMessage).toMatch(/GPS_MANUAL/);
    expect(signals.applyLimits).not.toHaveBeenCalled();
    expect(prisma.animal.update.mock.calls[0][0].data).toMatchObject({ lastHeartRate: 66 });
    expect(prisma.animal.update.mock.calls[0][0].data).not.toHaveProperty('lastLatitude');
    expect(prisma.telemetry.create.mock.calls[0][0].data.latitude).toBe(RED);
  });

  it('GPS_MANUAL: a retried ping (duplicate timestamp) delivers no signal', async () => {
    const { svc, prisma, signals, device } = setup({ controlMode: 'GPS_MANUAL', manualLatitude: ORANGE, manualLongitude: LNG });
    prisma.telemetry.findFirst.mockResolvedValue({ id: 'x' });
    const r: any = await svc.processDeviceTelemetry(device, ping(GREEN));
    expect(r).toMatchObject({ zone: 'ORANGE', sound: false, vibrate: false });
    expect(signals.applyLimits).not.toHaveBeenCalled();
  });
});

describe('PART 2 signal escalation', () => {
  it('zoneRank orders the signalling zones', () => {
    expect(['GREEN', 'UNKNOWN', 'ESCAPE', null].map((z) => zoneRank(z as any))).toEqual([0, 0, 0, 0]);
    expect([zoneRank('YELLOW'), zoneRank('ORANGE'), zoneRank('RED')]).toEqual([1, 2, 3]);
  });

  it('escalation is flagged when entering a MORE severe zone, not when staying or de-escalating', async () => {
    useFakeDate();
    const { svc, signals, device } = setup();
    const flag = async (lat: number) => {
      tick();
      signals.applyLimits.mockClear();
      await svc.processDeviceTelemetry(device, ping(lat));
      return signals.applyLimits.mock.calls[0]?.[0]?.escalation;
    };
    expect(await flag(GREEN)).toBe(false); // GREEN asks for no signal: nothing to escalate
    expect(await flag(YELLOW)).toBe(true); // GREEN -> YELLOW
    expect(await flag(YELLOW)).toBe(false); // same zone: normal cooldown
    expect(await flag(ORANGE)).toBe(true); // YELLOW -> ORANGE
    expect(await flag(ORANGE)).toBe(false);
    expect(await flag(RED)).toBe(true); // ORANGE -> RED
    expect(await flag(ORANGE)).toBe(false); // RED -> ORANGE is a de-escalation
  });

  it('the first ping of an animal (also after a restart) is no escalation: the normal cooldown applies', async () => {
    const { svc, signals, device } = setup();
    await svc.processDeviceTelemetry(device, ping(YELLOW));
    expect(signals.applyLimits.mock.calls[0][0].escalation).toBe(false);
  });

  it('works in GPS_MANUAL too: dragging GREEN -> ORANGE at once is an escalation', async () => {
    useFakeDate();
    const { svc, signals, device } = setup({ controlMode: 'GPS_MANUAL', manualLatitude: GREEN, manualLongitude: LNG });
    await svc.processDeviceTelemetry(device, ping(GREEN));
    device.manualLatitude = ORANGE;
    tick();
    await svc.processDeviceTelemetry(device, ping(GREEN));
    expect(signals.applyLimits.mock.calls.at(-1)[0].escalation).toBe(true);
  });

  describe('SignalsService', () => {
    function world() {
      const events: any[] = [];
      const prisma: any = {
        signalLimit: { findMany: jest.fn(async () => [{ level: 'SOUND', dailyLimit: 3, unlimited: false }]) },
        signalEvent: {
          findFirst: jest.fn(async () => null),
          count: jest.fn(async () => 0),
          createMany: jest.fn(async ({ data }: any) => { events.push(...data); }),
        },
        alert: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => data) },
      };
      return { svc: new SignalsService(prisma, new AlertsService(prisma)), prisma, events };
    }
    const T = new Date(Date.UTC(2026, 10, 10, 8, 0, 0));
    const args = (s: number, over: any = {}) => ({
      farmId: 'F', timezone: 'Asia/Aqtau', animal: { id: 'a1', name: 'A' }, deviceId: 'Q', sound: true, vibrate: true,
      now: new Date(T.getTime() + s * 1000), ...over,
    });

    it('an escalation delivers inside the cooldown, is recorded, and counts against the daily limit; the next plain one is still cooled down', async () => {
      const { svc, prisma, events } = world();
      expect((await svc.applyLimits(args(0, { vibrate: false }))).sound).toBe(true); // YELLOW sound
      expect(await svc.applyLimits(args(2))).toEqual({ sound: false, vibrate: true, suppressed: false }); // plain ORANGE: sound cooled down
      expect(await svc.applyLimits(args(3, { escalation: true }))).toEqual({ sound: true, vibrate: true, suppressed: false });
      expect(events.filter((e) => e.level === 'SOUND')).toHaveLength(2);
      expect(prisma.signalEvent.count).toHaveBeenCalled(); // the limit was consulted
      expect(await svc.applyLimits(args(4))).toEqual({ sound: false, vibrate: false, suppressed: false }); // cooldown restarted at the escalation
    });

    it('an escalation is still stopped by the daily limit', async () => {
      const { svc, prisma } = world();
      prisma.signalEvent.count.mockResolvedValue(3);
      expect(await svc.applyLimits(args(0, { vibrate: false, escalation: true }))).toEqual({ sound: false, vibrate: false, suppressed: true });
    });
  });
});

describe('PART 2 command delivery robustness', () => {
  const cmd = (over: any = {}) => ({ id: 'c1', command: 'TEST_SOUND', status: 'PENDING', deliveryCount: 0, deliveredAt: null, executedAt: null, ...over });

  it('delivers the same id twice, then marks it EXECUTED; a third ping gets nothing', async () => {
    useFakeDate();
    const { svc, device, commands } = setup();
    commands.push(cmd());
    const r1: any = await svc.processDeviceTelemetry(device, ping());
    expect(r1.command).toEqual({ id: 'c1', type: 'TEST_SOUND' });
    expect(commands[0]).toMatchObject({ status: 'PENDING', deliveryCount: 1 });
    expect(commands[0].deliveredAt).toBeInstanceOf(Date);
    tick();
    const r2: any = await svc.processDeviceTelemetry(device, ping());
    expect(r2.command).toEqual({ id: 'c1', type: 'TEST_SOUND' }); // the first reply may have been lost
    expect(commands[0]).toMatchObject({ status: 'EXECUTED', deliveryCount: 2 });
    expect(commands[0].executedAt).toBeInstanceOf(Date);
    tick();
    expect((await svc.processDeviceTelemetry(device, ping())).command).toBeUndefined();
  });

  it('a command first delivered more than 20 s ago is closed without a re-delivery and the next one goes out', async () => {
    useFakeDate();
    const { svc, device, commands } = setup();
    commands.push(cmd({ deliveryCount: 1, deliveredAt: new Date(Date.now() - COMMAND_REDELIVER_WINDOW_MS - 1000) }));
    commands.push(cmd({ id: 'c2', command: 'TEST_VIBRATION' }));
    const r: any = await svc.processDeviceTelemetry(device, ping());
    expect(commands[0].status).toBe('EXECUTED');
    expect(r.command).toEqual({ id: 'c2', type: 'TEST_VIBRATION' });
  });

  it('within 20 s a once-delivered command is re-delivered even on a slow ping', async () => {
    useFakeDate();
    const { svc, device, commands } = setup();
    commands.push(cmd({ deliveryCount: 1, deliveredAt: new Date(Date.now() - 15_000) }));
    expect(((await svc.processDeviceTelemetry(device, ping())) as any).command.id).toBe('c1');
  });

  it('a lost race (parallel ping took the delivery) delivers nothing and does not throw', async () => {
    const { svc, device, commands, prisma } = setup();
    commands.push(cmd());
    prisma.deviceCommand.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(((await svc.processDeviceTelemetry(device, ping())) as any).command).toBeUndefined();
  });

  it('commands are delivered whatever the control mode', async () => {
    for (const controlMode of ['AUTO', 'MANUAL', 'GPS_MANUAL']) {
      const { svc, device, commands } = setup({ controlMode });
      commands.push(cmd());
      expect(((await svc.processDeviceTelemetry(device, ping())) as any).command.id).toBe('c1');
    }
  });
});

describe('PART 2 CollarControlService', () => {
  function control(deviceOver: any = {}, animalOver: any = {}) {
    const device: any = {
      id: 'd1', deviceId: 'QAM-00000001', code: '00000001', farmId: 'F', isSimulated: false, controlMode: 'GPS_MANUAL', signal: -70,
      lastHeartbeatAt: new Date(), manualLatitude: null, manualLongitude: null,
      controlModeSince: new Date(Date.now() - 60_000), controlActivityAt: new Date(Date.now() - 60_000),
      animal: { id: 'a1', name: 'Mira', species: 'CATTLE', isDemo: false, isOutsideGeofence: false, activeGeofence: { polygonJson: poly }, ...animalOver },
      ...deviceOver,
    };
    const prisma: any = {
      device: {
        findFirst: jest.fn(async ({ where }: any) => (where.deviceId === device.deviceId && where.farmId === 'F' ? device : null)),
        update: jest.fn(async ({ data }: any) => ({ ...device, ...data, animal: { id: 'a1', name: 'Mira' } })),
      },
      animal: { update: jest.fn() },
      telemetry: { findFirst: jest.fn(async () => null) },
      deviceCommand: { create: jest.fn() },
      signalEvent: { createMany: jest.fn() },
    };
    const alerts: any = { triggerGeofenceBreach: jest.fn(), resolveGeofenceBreach: jest.fn(), resolveGpsLost: jest.fn() };
    const signals: any = { applyLimits: jest.fn() };
    const config: any = { get: (_k: string, d: string) => d };
    const telemetry = new TelemetryService(prisma, new GeofenceService({} as any), alerts, config, signals, new LiveViewersService());
    const svc = new CollarControlService(prisma, new GeofenceService({} as any), alerts, telemetry);
    const events: any[] = [];
    telemetry.getTelemetryStream('F').subscribe((e) => events.push(e));
    return { svc, prisma, alerts, signals, events, device };
  }

  it('setControlMode: 404 unknown / foreign, 409 for a demo collar or one without an animal', async () => {
    const c = control();
    await expect(c.svc.setControlMode('F', 'QAM-NOPE', 'AUTO')).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.svc.setControlMode('OTHER', 'QAM-00000001', 'AUTO')).rejects.toBeInstanceOf(NotFoundException);
    const demo = control({ isSimulated: true });
    await expect(demo.svc.setControlMode('F', 'QAM-00000001', 'MANUAL')).rejects.toBeInstanceOf(ConflictException);
    const free = control({ animal: null });
    await expect(free.svc.setControlMode('F', 'QAM-00000001', 'MANUAL')).rejects.toBeInstanceOf(ConflictException);
    expect(demo.prisma.device.update).not.toHaveBeenCalled();
  });

  it('setControlMode: leaving GPS_MANUAL clears the manual position; entering it closes GPS_LOST and starts empty', async () => {
    const leave = control({ controlMode: 'GPS_MANUAL', manualLatitude: 1, manualLongitude: 2 });
    const out = await leave.svc.setControlMode('F', 'QAM-00000001', 'AUTO');
    expect(leave.prisma.device.update.mock.calls[0][0].data).toEqual({ controlMode: 'AUTO', manualLatitude: null, manualLongitude: null, manualPositionAt: null, controlModeSince: null, controlActivityAt: null });
    expect(out).toMatchObject({ controlMode: 'AUTO', positionSource: 'GPS' });

    const enter = control({ controlMode: 'AUTO' });
    const into = await enter.svc.setControlMode('F', 'QAM-00000001', 'GPS_MANUAL');
    expect(enter.alerts.resolveGpsLost).toHaveBeenCalledWith('a1');
    expect(enter.prisma.device.update.mock.calls[0][0].data).toMatchObject({ controlMode: 'GPS_MANUAL', manualLatitude: null });
    expect(into).toMatchObject({ controlMode: 'GPS_MANUAL', positionSource: 'MANUAL' });

    const same = control({ controlMode: 'GPS_MANUAL', manualLatitude: 1, manualLongitude: 2 });
    await same.svc.setControlMode('F', 'QAM-00000001', 'GPS_MANUAL');
    const sd = same.prisma.device.update.mock.calls[0][0].data;
    expect(sd).toMatchObject({ controlMode: 'GPS_MANUAL', controlModeSince: same.device.controlModeSince }); // idempotent, keeps the point and the start
    expect(sd).not.toHaveProperty('manualLatitude');
    expect(sd.controlActivityAt).toBeInstanceOf(Date); // but it is operator activity

    const man = control({ controlMode: 'AUTO' });
    expect(await man.svc.setControlMode('F', 'QAM-00000001', 'MANUAL')).toMatchObject({ controlMode: 'MANUAL', positionSource: 'GPS' });
    expect(man.alerts.resolveGpsLost).not.toHaveBeenCalled();
  });

  it('setManualPosition: 409 outside GPS_MANUAL, for a demo collar and without an animal', async () => {
    for (const mode of ['AUTO', 'MANUAL']) {
      const c = control({ controlMode: mode });
      await expect(c.svc.setManualPosition('F', 'QAM-00000001', GREEN, LNG)).rejects.toBeInstanceOf(ConflictException);
      expect(c.prisma.animal.update).not.toHaveBeenCalled();
    }
    await expect(control({ isSimulated: true }).svc.setManualPosition('F', 'QAM-00000001', GREEN, LNG)).rejects.toBeInstanceOf(ConflictException);
    await expect(control({ animal: null }).svc.setManualPosition('F', 'QAM-00000001', GREEN, LNG)).rejects.toBeInstanceOf(ConflictException);
    await expect(control().svc.setManualPosition('OTHER', 'QAM-00000001', GREEN, LNG)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setManualPosition: stores the point, moves the animal, broadcasts, queues and delivers no signal', async () => {
    const c = control();
    const res = await c.svc.setManualPosition('F', 'QAM-00000001', YELLOW, LNG);
    expect(res).toMatchObject({
      deviceId: 'QAM-00000001', controlMode: 'GPS_MANUAL', positionSource: 'MANUAL', zone: 'YELLOW', inFence: true,
      position: { latitude: YELLOW, longitude: LNG },
    });
    expect(res.position.at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(res.distanceToBorderMeters).toBeGreaterThan(5);
    expect(c.prisma.device.update.mock.calls[0][0].data).toMatchObject({ manualLatitude: YELLOW, manualLongitude: LNG });
    expect(c.prisma.device.update.mock.calls[0][0].data.manualPositionAt).toBeInstanceOf(Date);
    expect(c.prisma.animal.update.mock.calls[0][0].data).toMatchObject({
      lastLatitude: YELLOW, lastLongitude: LNG, lastAccuracy: 0, isOutsideGeofence: false,
    });
    expect(c.prisma.animal.update.mock.calls[0][0].data.lastSeenAt).toBeInstanceOf(Date);
    expect(c.events).toHaveLength(1);
    expect(c.events[0]).toMatchObject({
      deviceId: 'QAM-00000001', animalId: 'a1', latitude: YELLOW, longitude: LNG, accuracyM: 0, zone: 'YELLOW',
      sound: false, vibrate: false, positionSource: 'MANUAL', controlMode: 'GPS_MANUAL', farmId: 'F',
    });
    expect(c.signals.applyLimits).not.toHaveBeenCalled();
    expect(c.prisma.deviceCommand.create).not.toHaveBeenCalled();
    expect(c.prisma.signalEvent.createMany).not.toHaveBeenCalled();
    expect(c.alerts.triggerGeofenceBreach).not.toHaveBeenCalled();
  });

  it('setManualPosition: dragging outside raises the breach once (transition), dragging back resolves it', async () => {
    const out = control();
    const r = await out.svc.setManualPosition('F', 'QAM-00000001', RED, LNG);
    expect(r).toMatchObject({ zone: 'RED', inFence: false });
    expect(out.prisma.animal.update.mock.calls[0][0].data.isOutsideGeofence).toBe(true);
    expect(out.alerts.triggerGeofenceBreach).toHaveBeenCalledWith(expect.objectContaining({ animalId: 'a1', latitude: RED, freshBreach: true }));

    const stay = control({}, { isOutsideGeofence: true });
    await stay.svc.setManualPosition('F', 'QAM-00000001', RED, LNG);
    expect(stay.alerts.triggerGeofenceBreach).not.toHaveBeenCalled(); // no query per drag step

    const back = control({}, { isOutsideGeofence: true });
    await back.svc.setManualPosition('F', 'QAM-00000001', GREEN, LNG);
    expect(back.alerts.resolveGeofenceBreach).toHaveBeenCalledTimes(1);
    expect(back.prisma.animal.update.mock.calls[0][0].data.isOutsideGeofence).toBe(false);
  });

  it('setManualPosition without a boundary: zone UNKNOWN, the position is still stored, no alert', async () => {
    const c = control({}, { activeGeofence: null });
    const r = await c.svc.setManualPosition('F', 'QAM-00000001', GREEN, LNG);
    expect(r).toMatchObject({ zone: 'UNKNOWN', inFence: null, distanceToBorderMeters: null });
    expect(c.prisma.animal.update).toHaveBeenCalled();
    expect(c.alerts.triggerGeofenceBreach).not.toHaveBeenCalled();
  });

  it('the following ping of the ESP sees the stored manual point and delivers the signals (not the route)', async () => {
    useFakeDate();
    const c = control();
    await c.svc.setManualPosition('F', 'QAM-00000001', ORANGE, LNG);
    const stored = c.prisma.device.update.mock.calls[0][0].data;
    const t = setup({ controlMode: 'GPS_MANUAL', manualLatitude: stored.manualLatitude, manualLongitude: stored.manualLongitude });
    const r: any = await t.svc.processDeviceTelemetry(t.device, ping(GREEN));
    expect(r).toMatchObject({ zone: 'ORANGE', sound: true, vibrate: true, vibrateDurationMs: 3000 });
  });
});

describe('PART 2 routes, validation and DTOs', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const check = (type: any, value: any) => pipe.transform(value, { type: 'body', metatype: type });

  it('control-mode accepts the three modes only', async () => {
    for (const mode of ['AUTO', 'GPS_MANUAL', 'MANUAL']) await expect(check(SetControlModeDto, { mode })).resolves.toMatchObject({ mode });
    for (const bad of [{ mode: 'FOO' }, {}, { mode: 'auto' }, { mode: 'AUTO', extra: 1 }]) await expect(check(SetControlModeDto, bad)).rejects.toBeDefined();
  });

  it('manual-position validates ranges and types', async () => {
    await expect(check(ManualPositionDto, { latitude: 43.65, longitude: 51.15 })).resolves.toMatchObject({ latitude: 43.65 });
    await expect(check(ManualPositionDto, { latitude: -90, longitude: 180 })).resolves.toBeDefined();
    for (const bad of [
      { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: '43', longitude: 51 },
      { latitude: null, longitude: 1 }, { latitude: 1 }, { latitude: 1, longitude: 2, speed: 3 },
    ]) await expect(check(ManualPositionDto, bad)).rejects.toBeDefined();
  });

  it('the drag route is rate limited per user (120/min), the mode route 30/min', () => {
    const proto = CollarControlController.prototype as any;
    const drag = Reflect.getMetadata(RATE_LIMIT_KEY, proto.setManualPosition);
    expect(drag.rules).toEqual([expect.objectContaining({ limit: 120, windowMs: 60_000, perUser: true })]);
    const mode = Reflect.getMetadata(RATE_LIMIT_KEY, proto.setControlMode);
    expect(mode.rules).toEqual([expect.objectContaining({ limit: 30, perUser: true })]);
  });

  it('the collar DTO exposes controlMode and positionSource', () => {
    expect(toCollarDto({ deviceId: 'Q', animal: null })).toMatchObject({ controlMode: 'AUTO', positionSource: 'GPS' });
    expect(toCollarDto({ deviceId: 'Q', animal: null, controlMode: 'GPS_MANUAL' })).toMatchObject({ controlMode: 'GPS_MANUAL', positionSource: 'MANUAL' });
    expect(toCollarDto({ deviceId: 'Q', animal: null, controlMode: 'MANUAL' })).toMatchObject({ controlMode: 'MANUAL', positionSource: 'GPS' });
  });

  it('the animal DTO exposes the mode of its collar (null without a collar)', () => {
    const base = { id: 'a', farmId: 'F', name: 'N', tagNumber: 'T', species: 'CATTLE', gender: 'FEMALE', isOutsideGeofence: false, alerts: [] };
    const now = Date.now();
    expect(toAnimalDto({ ...base, device: { deviceId: 'Q', lastHeartbeatAt: new Date(), controlMode: 'GPS_MANUAL' } }, now)).toMatchObject({ controlMode: 'GPS_MANUAL', positionSource: 'MANUAL' });
    expect(toAnimalDto({ ...base, device: { deviceId: 'Q', lastHeartbeatAt: new Date() } }, now)).toMatchObject({ controlMode: 'AUTO', positionSource: 'GPS' });
    expect(toAnimalDto({ ...base, device: null }, now)).toMatchObject({ controlMode: null, positionSource: 'GPS' });
  });

  it('a Subject-based stream still hides farmId while carrying the new fields', async () => {
    const { svc, device } = setup({ controlMode: 'MANUAL' });
    const got: any[] = [];
    const sub = svc.openStream({ userId: 'u', farmId: 'f1' }).subscribe((e) => got.push(e));
    await svc.processDeviceTelemetry(device, ping());
    sub.unsubscribe();
    const t = got.find((e) => e.data.type === 'telemetry');
    expect(t.data).toMatchObject({ controlMode: 'MANUAL', positionSource: 'GPS' });
    expect(t.data).not.toHaveProperty('farmId');
    expect(new Subject()).toBeDefined();
  });
});
