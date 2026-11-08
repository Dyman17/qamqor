import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { FakePrisma } from './helpers/fake-prisma';
import { FarmsService } from '../src/farms/farms.service';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { GeofenceService } from '../src/geofences/geofence.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { SignalsService } from '../src/signals/signals.service';
import { OfflineWatcherService } from '../src/devices/offline-watcher.service';
import { AnimalsService } from '../src/animals/animals.service';
import { DevicesService } from '../src/devices/devices.service';
import { SimulationService } from '../src/simulation/simulation.service';
import { SimulatorService, VIEW_TTL_MS, DEMO_ALERT_MAX } from '../src/simulation/simulator.service';
import { DemoDataService, DEMO_PEN } from '../src/simulation/demo-data.service';
import { PenGeometry, rectanglePolygon } from '../src/simulation/geometry';
import { clearPenCache } from '../src/simulation/pen-cache';
import { newAnimalSim, newFarmSim, restoreAnimalSim, stepAnimal, SCRIPTED_ROLES } from '../src/simulation/scenario';
import { toFarmDto } from '../src/farms/farms.service';

const T0 = Date.UTC(2026, 10, 9, 8, 0, 0);
const OWNER = 'u-owner';
const WORKER = 'u-worker';

function useFakeClock(at: number = T0) {
  jest.useFakeTimers({
    now: at,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
      'clearInterval', 'setTimeout', 'clearTimeout',
    ],
  });
}

async function build() {
  const prisma = new FakePrisma();
  const config: any = { get: (_k: string, d: string) => d };
  const geofence = new GeofenceService(prisma as any);
  const alerts = new AlertsService(prisma as any);
  const signals = new SignalsService(prisma as any, alerts);
  const telemetry = new TelemetryService(prisma as any, geofence, alerts, config, signals);
  const watcher = new OfflineWatcherService(prisma as any, alerts);
  const farms = new FarmsService(prisma as any);
  const demo = new DemoDataService(prisma as any);
  const simulator = new SimulatorService(prisma as any, telemetry, watcher, demo);
  const sim = new SimulationService(prisma as any, farms, telemetry, demo, simulator);

  const farm = await prisma.farm.create({ data: { name: 'Farm', ownerId: OWNER } });
  await prisma.farmMember.create({ data: { userId: OWNER, farmId: farm.id, role: 'OWNER' } });
  await prisma.farmMember.create({ data: { userId: WORKER, farmId: farm.id, role: 'WORKER' } });
  return { prisma, geofence, alerts, telemetry, watcher, farms, demo, simulator, sim, farm };
}
type Ctx = Awaited<ReturnType<typeof build>>;

/** A real (non-demo) pen, animal and collar in the same farm. */
async function addReal(c: Ctx) {
  const pen = await c.prisma.geofence.create({
    data: { farmId: c.farm.id, name: 'Real pen', polygonJson: rectanglePolygon(43.65, 51.157, 600, 400) },
  });
  const animal = await c.prisma.animal.create({
    data: { farmId: c.farm.id, name: 'Real cow', tagNumber: 'KZ-1', species: 'CATTLE', activeGeofenceId: pen.id },
  });
  const device = await c.prisma.device.create({
    data: { deviceId: 'QAM-0001', secretHash: 'h', farmId: c.farm.id, animalId: animal.id, lastHeartbeatAt: new Date() },
  });
  return { pen, animal, device };
}

const alertTypes = (c: Ctx, over: any = {}) =>
  c.prisma.tables.alert.filter((a) => Object.entries(over).every(([k, v]) => a[k] === v)).map((a) => a.type);

afterEach(() => {
  jest.useRealTimers();
  delete process.env.DEMO_MODES_ENABLED;
  clearPenCache();
});

// ---------------------------------------------------------------------------------------------

describe('modes and permissions', () => {
  it('a worker can read the state but every mutation is FORBIDDEN_ROLE', async () => {
    const c = await build();
    const st = await c.sim.getState(WORKER, c.farm.id);
    expect(st).toMatchObject({ dataMode: 'REAL', running: false, enabled: true, demo: { animals: 0, alerts: 0 } });
    const id = '3f2b8c1e-9d4a-4c1b-8f6e-2a7d5b9c0e11';
    const calls: Array<() => Promise<any>> = [
      () => c.sim.setMode(WORKER, c.farm.id, 'MANUAL'),
      () => c.sim.start(WORKER, c.farm.id, {}),
      () => c.sim.stop(WORKER, c.farm.id),
      () => c.sim.reset(WORKER, c.farm.id),
      () => c.sim.setSpeed(WORKER, c.farm.id, 2),
      () => c.sim.createAnimal(WORKER, c.farm.id, {}),
      () => c.sim.simulateTelemetry(WORKER, c.farm.id, { animalId: id, lat: 1, lng: 1 }),
      () => c.sim.simulateEvent(WORKER, c.farm.id, { animalId: id, event: 'BREACH' }),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect((await c.prisma.farm.findUnique({ where: { id: c.farm.id } })).dataMode).toBe('REAL');
  });

  it('a stranger gets FORBIDDEN_FARM', async () => {
    const c = await build();
    await expect(c.sim.getState('nobody', c.farm.id)).rejects.toMatchObject({ response: { code: 'FORBIDDEN_FARM' } });
  });

  it('REAL -> MANUAL -> AUTO -> MANUAL -> REAL, demo data kept until REAL', async () => {
    useFakeClock();
    const c = await build();
    expect((await c.sim.setMode(OWNER, c.farm.id, 'MANUAL')).dataMode).toBe('MANUAL');
    const a = await c.sim.createAnimal(OWNER, c.farm.id, {});
    expect(a).toMatchObject({ isDemo: true, tag: 'D-001' });
    expect(a.collarId).toMatch(/^QAM-DEMO-[0-9A-F]{4}$/);

    const auto = await c.sim.setMode(OWNER, c.farm.id, 'AUTO');
    expect(auto).toMatchObject({ dataMode: 'AUTO', running: true, speed: 1, herd: 8 });
    expect(new Date(auto.until!).getTime() - T0).toBe(2 * 3600_000); // default auto-stop 2 h
    expect(auto.demo.animals).toBe(8);

    const stopped = await c.sim.stop(OWNER, c.farm.id);
    expect(stopped).toMatchObject({ dataMode: 'MANUAL', running: false, until: null });
    expect(stopped.demo.animals).toBe(8);

    const real = await c.sim.setMode(OWNER, c.farm.id, 'REAL');
    expect(real).toMatchObject({ dataMode: 'REAL', demo: { animals: 0, alerts: 0 } });
    expect(c.prisma.tables.animal).toHaveLength(0);
    expect(c.prisma.tables.device).toHaveLength(0);
    expect(c.prisma.tables.geofence).toHaveLength(0); // the demo pen is gone too
  });

  it('start validates nothing itself (DTO does) but honours speed, herd and hours; PATCH changes the speed', async () => {
    useFakeClock();
    const c = await build();
    const r = await c.sim.start(OWNER, c.farm.id, { speed: 5, herd: 3, hours: 4 });
    expect(r).toMatchObject({ dataMode: 'AUTO', speed: 5, herd: 3 });
    expect(new Date(r.until!).getTime() - T0).toBe(4 * 3600_000);
    expect(r.demo.animals).toBe(3);
    expect((await c.sim.setSpeed(OWNER, c.farm.id, 10)).speed).toBe(10);
    // fewer animals on the next start: the surplus is removed with its collar
    const again = await c.sim.start(OWNER, c.farm.id, { herd: 2 });
    expect(again.demo.animals).toBe(2);
    expect(c.prisma.tables.device).toHaveLength(2);
  });

  it('stop / reset / speed in REAL are 409', async () => {
    const c = await build();
    await expect(c.sim.stop(OWNER, c.farm.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(c.sim.reset(OWNER, c.farm.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(c.sim.setSpeed(OWNER, c.farm.id, 2)).rejects.toBeInstanceOf(ConflictException);
  });

  it('DEMO_MODES_ENABLED=false: routes answer 404, the state read still says enabled:false', async () => {
    const c = await build();
    process.env.DEMO_MODES_ENABLED = 'false';
    expect((await c.sim.getState(OWNER, c.farm.id)).enabled).toBe(false);
    await expect(c.sim.setMode(OWNER, c.farm.id, 'MANUAL')).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.sim.start(OWNER, c.farm.id, {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.sim.createAnimal(OWNER, c.farm.id, {})).rejects.toBeInstanceOf(NotFoundException);
    const before = c.prisma.calls;
    expect((await c.simulator.tick(new Date())).farms).toBe(0);
    expect(c.prisma.calls).toBe(before);
  });

  it('FarmDto carries dataMode', async () => {
    const c = await build();
    await c.sim.setMode(OWNER, c.farm.id, 'MANUAL');
    const farm = await c.prisma.farm.findUnique({ where: { id: c.farm.id } });
    expect(toFarmDto(farm, 'OWNER').dataMode).toBe('MANUAL');
  });
});

// ---------------------------------------------------------------------------------------------

describe('manual input', () => {
  async function manual(withRealPen = false) {
    useFakeClock();
    const c = await build();
    const real = withRealPen ? await addReal(c) : null;
    await c.sim.setMode(OWNER, c.farm.id, 'MANUAL');
    const animal = await c.sim.createAnimal(OWNER, c.farm.id, { name: 'Бота' });
    return { c, real, animal };
  }

  it('REAL and AUTO mode: manual calls are 409', async () => {
    useFakeClock();
    const c = await build();
    const id = '3f2b8c1e-9d4a-4c1b-8f6e-2a7d5b9c0e11';
    await expect(c.sim.createAnimal(OWNER, c.farm.id, {})).rejects.toBeInstanceOf(ConflictException);
    await expect(c.sim.simulateEvent(OWNER, c.farm.id, { animalId: id, event: 'BREACH' })).rejects.toBeInstanceOf(ConflictException);
    await c.sim.setMode(OWNER, c.farm.id, 'AUTO');
    await expect(c.sim.createAnimal(OWNER, c.farm.id, {})).rejects.toMatchObject({ message: expect.stringContaining('остановите') });
    await expect(c.sim.simulateTelemetry(OWNER, c.farm.id, { animalId: id, lat: 1, lng: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('a real animal (or a foreign id) is 404 and nothing is written', async () => {
    const { c, real } = await manual(true);
    const calls = c.prisma.calls;
    await expect(c.sim.simulateEvent(OWNER, c.farm.id, { animalId: real!.animal.id, event: 'BREACH' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.sim.simulateTelemetry(OWNER, c.farm.id, { animalId: real!.animal.id, lat: 43.65, lng: 51.157 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.sim.simulateEvent(OWNER, c.farm.id, { animalId: '3f2b8c1e-9d4a-4c1b-8f6e-2a7d5b9c0e11', event: 'RETURN' })).rejects.toBeInstanceOf(NotFoundException);
    expect(c.prisma.tables.telemetry).toHaveLength(0);
    expect(c.prisma.calls).toBeGreaterThan(calls); // lookups only
    expect(c.prisma.tables.alert).toHaveLength(0);
  });

  it('the demo herd always gets its own demo pen: a copy of the real polygon, the real pen is never reused', async () => {
    const { c, real, animal } = await manual(true);
    expect(c.prisma.tables.geofence).toHaveLength(2);
    const demoPen = c.prisma.tables.geofence.find((g) => g.isDemo);
    expect(animal.penId).toBe(demoPen.id);
    expect(animal.penId).not.toBe(real!.pen.id);
    expect(demoPen.polygonJson).toEqual(real!.pen.polygonJson);
    expect(c.prisma.tables.geofence.find((g) => g.id === real!.pen.id).isDemo).toBe(false);
    const empty = await build();
    await empty.sim.setMode(OWNER, empty.farm.id, 'MANUAL');
    await empty.sim.createAnimal(OWNER, empty.farm.id, {});
    expect(empty.prisma.tables.geofence).toEqual([expect.objectContaining({ name: DEMO_PEN.name, isDemo: true })]);
  });

  it('REAL keeps the real pen and its animals fenced; a demo pen adopted by a real animal is kept, not deleted', async () => {
    const { c, real } = await manual(true);
    await c.sim.setMode(OWNER, c.farm.id, 'REAL');
    expect(c.prisma.tables.geofence.map((g) => g.id)).toEqual([real!.pen.id]);
    expect(c.prisma.tables.animal.find((a) => a.id === real!.animal.id).activeGeofenceId).toBe(real!.pen.id);

    const d = await manual(true);
    const demoPen = d.c.prisma.tables.geofence.find((g) => g.isDemo);
    await d.c.prisma.animal.updateMany({ where: { id: d.real!.animal.id }, data: { activeGeofenceId: demoPen.id } });
    await d.c.sim.setMode(OWNER, d.c.farm.id, 'REAL');
    expect(d.c.prisma.tables.geofence.some((g) => g.id === demoPen.id && g.isDemo === false)).toBe(true);
    expect(d.c.prisma.tables.animal.find((a) => a.id === d.real!.animal.id).activeGeofenceId).toBe(demoPen.id);
  });

  it('the demo tag never collides with a real animal tag (D-001 taken by a real animal)', async () => {
    useFakeClock();
    const c = await build();
    await c.prisma.animal.create({ data: { farmId: c.farm.id, name: 'Real', tagNumber: 'D-001', species: 'CATTLE' } });
    await c.sim.setMode(OWNER, c.farm.id, 'MANUAL');
    const a = await c.sim.createAnimal(OWNER, c.farm.id, {});
    expect(a.tag).toBe('D-002');
    const b = await c.sim.createAnimal(OWNER, c.farm.id, {});
    expect(b.tag).toBe('D-003');
  });

  it('a lost race on the 20-animal cap removes the loser and answers 409', async () => {
    const { c } = await manual();
    const real = c.prisma.animal.count;
    let n = 0;
    // the pre-check sees room, the post-check (after the insert) sees 21
    c.prisma.animal.count = jest.fn(async (arg: any) => (arg?.where?.isDemo ? (++n === 1 ? 0 : 21) : real(arg)));
    const before = c.prisma.tables.animal.length;
    await expect(c.sim.createAnimal(OWNER, c.farm.id, {})).rejects.toBeInstanceOf(ConflictException);
    expect(c.prisma.tables.animal).toHaveLength(before);
    expect(c.prisma.tables.device.filter((d) => d.isSimulated)).toHaveLength(before);
  });

  it('BREACH: RED with sound and vibration, a GEOFENCE_BREACH demo alert; RETURN: GEOFENCE_RETURN', async () => {
    const { c, animal } = await manual();
    const breach = (await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: animal.id, event: 'BREACH' })) as any;
    expect(breach).toMatchObject({ zone: 'RED', inFence: false, sound: true, vibrate: true, toneFrequencyHz: 2400, suppressedBy: null });
    expect(breach.distanceToBorderMeters).toBeGreaterThan(15);
    expect(breach.distanceToBorderMeters).toBeLessThan(60);
    const a = c.prisma.tables.alert.find((x) => x.type === 'GEOFENCE_BREACH');
    expect(a).toMatchObject({ isDemo: true, severity: 'CRITICAL', status: 'ACTIVE' });

    const back = (await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: animal.id, event: 'RETURN' })) as any;
    expect(back).toMatchObject({ inFence: true, sound: false, vibrate: false });
    expect(c.prisma.tables.alert.find((x) => x.type === 'GEOFENCE_BREACH').status).toBe('RESOLVED');
    expect(c.prisma.tables.alert.find((x) => x.type === 'GEOFENCE_RETURN')).toMatchObject({ isDemo: true });
  });

  it('ESCAPE: zone ESCAPE, signals off (anti-panic), breach alert', async () => {
    const { c, animal } = await manual();
    const r = (await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: animal.id, event: 'ESCAPE' })) as any;
    expect(r).toMatchObject({ zone: 'ESCAPE', sound: false, vibrate: false, toneFrequencyHz: 0 });
    expect(r.distanceToBorderMeters).toBeGreaterThan(100);
    expect(alertTypes(c)).toContain('GEOFENCE_BREACH');
  });

  it('GPS_LOST opens a GPS_LOST alert, a good fix (COLLAR_ONLINE) closes it', async () => {
    const { c, animal } = await manual();
    const r = (await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: animal.id, event: 'GPS_LOST' })) as any;
    expect(r).toMatchObject({ zone: 'UNKNOWN', inFence: null, sound: false, vibrate: false });
    expect(c.prisma.tables.alert.find((x) => x.type === 'GPS_LOST')).toMatchObject({ status: 'ACTIVE', isDemo: true });
    await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: animal.id, event: 'COLLAR_ONLINE' });
    expect(c.prisma.tables.alert.find((x) => x.type === 'GPS_LOST').status).toBe('RESOLVED');
  });

  it('COLLAR_OFFLINE raises DEVICE_OFFLINE through the real watcher, COLLAR_ONLINE restores', async () => {
    const { c, animal } = await manual();
    await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: animal.id, event: 'GPS_LOST' }); // a ping first
    expect(await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: animal.id, event: 'COLLAR_OFFLINE' })).toEqual({ ok: true });
    expect(c.prisma.tables.alert.find((x) => x.type === 'DEVICE_OFFLINE')).toMatchObject({ status: 'ACTIVE', isDemo: true });
    await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: animal.id, event: 'COLLAR_ONLINE' });
    expect(c.prisma.tables.alert.find((x) => x.type === 'DEVICE_OFFLINE').status).toBe('RESOLVED');
    expect(c.prisma.tables.alert.find((x) => x.type === 'DEVICE_RESTORED')).toMatchObject({ isDemo: true });
  });

  it('free coordinates: the response is what the collar would get', async () => {
    const { c, animal } = await manual();
    // demo pen centre is inside, deep: GREEN
    const centre = (await c.sim.simulateTelemetry(OWNER, c.farm.id, { animalId: animal.id, lat: DEMO_PEN.lat, lng: DEMO_PEN.lng })) as any;
    expect(centre).toMatchObject({ zone: 'GREEN', inFence: true, sound: false, vibrate: false });
    // 3 m inside the northern border (200 m north of the centre)
    const lat = DEMO_PEN.lat + (200 - 3) / 111194.9266;
    const orange = await c.sim.simulateTelemetry(OWNER, c.farm.id, { animalId: animal.id, lat, lng: DEMO_PEN.lng });
    expect(orange).toMatchObject({ zone: 'ORANGE', sound: true, vibrate: true });
    const bad = await c.sim.simulateTelemetry(OWNER, c.farm.id, { animalId: animal.id, lat, lng: DEMO_PEN.lng, accuracyM: 60 });
    expect(bad.zone).toBe('UNKNOWN');
  });

  it('at most 20 demo animals; 60 manual calls per minute per user (429)', async () => {
    const { c, animal } = await manual();
    for (let i = 0; i < 19; i++) await c.sim.createAnimal(OWNER, c.farm.id, {});
    await expect(c.sim.createAnimal(OWNER, c.farm.id, {})).rejects.toBeInstanceOf(ConflictException);
    c.sim.limiter.reset();
    let last: any;
    for (let i = 0; i < 61; i++) {
      try {
        await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: animal.id, event: 'COLLAR_ONLINE' });
      } catch (e) {
        last = e;
      }
    }
    expect(last).toBeInstanceOf(HttpException);
    expect(last.getStatus()).toBe(429);
    expect(last.getResponse()).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

// ---------------------------------------------------------------------------------------------

describe('demo and real never mix', () => {
  it('a real animal cannot take a demo collar, a demo animal cannot take a real one (409)', async () => {
    useFakeClock();
    const c = await build();
    const real = await addReal(c);
    await c.sim.setMode(OWNER, c.farm.id, 'MANUAL');
    const demoAnimal = await c.sim.createAnimal(OWNER, c.farm.id, {});
    const free = await c.prisma.device.create({ data: { deviceId: 'QAM-0002', secretHash: 'h2', farmId: c.farm.id } });
    const demoCollar = c.prisma.tables.device.find((d) => d.isSimulated);
    // free the demo collar, then try to bind it to the real animal
    await c.prisma.device.updateMany({ where: { id: demoCollar.id }, data: { animalId: null } });
    const animals = new AnimalsService(c.prisma as any);
    await expect(animals.assignCollar(OWNER, c.farm.id, real.animal.id, demoCollar.deviceId)).rejects.toBeInstanceOf(ConflictException);
    // a real free collar to the demo animal
    await expect(animals.assignCollar(OWNER, c.farm.id, demoAnimal.id, free.deviceId)).rejects.toBeInstanceOf(ConflictException);
    // updateDevice and registerDevice take the same decision
    const devices = new DevicesService(c.prisma as any);
    await expect(devices.updateDevice(OWNER, c.farm.id, free.deviceId, { animalId: demoAnimal.id } as any)).rejects.toBeInstanceOf(ConflictException);
    await expect(devices.registerDevice(OWNER, c.farm.id, { deviceId: 'QAM-0003', animalId: demoAnimal.id } as any)).rejects.toBeInstanceOf(ConflictException);
    // PATCH animal with a collar and POST animal with a collar
    await expect(animals.updateAnimal(OWNER, c.farm.id, real.animal.id, { collarId: demoCollar.deviceId } as any)).rejects.toBeInstanceOf(ConflictException);
    await expect(animals.createAnimal(OWNER, c.farm.id, { name: 'n', tag: 'KZ-9', species: 'CATTLE', collarId: demoCollar.deviceId } as any)).rejects.toBeInstanceOf(ConflictException);
    // matching pairs still work
    const ok = await animals.assignCollar(OWNER, c.farm.id, demoAnimal.id, demoCollar.deviceId);
    expect(ok.collarId).toBe(demoCollar.deviceId);
  });

  it('REAL deletes every demo row and leaves the real animal, collar, pen, alerts and telemetry', async () => {
    useFakeClock();
    const c = await build();
    const real = await addReal(c);
    // real history
    await c.prisma.telemetry.create({ data: { deviceId: 'QAM-0001', animalId: real.animal.id, latitude: 43.65, longitude: 51.157, accuracy: 5, timestamp: new Date() } });
    await c.prisma.signalEvent.create({ data: { farmId: c.farm.id, animalId: real.animal.id, level: 'SOUND' } });
    await c.prisma.alert.create({ data: { farmId: c.farm.id, animalId: real.animal.id, type: 'GEOFENCE_BREACH', message: 'real' } });

    await c.sim.setMode(OWNER, c.farm.id, 'MANUAL');
    const d = await c.sim.createAnimal(OWNER, c.farm.id, {});
    await c.sim.simulateEvent(OWNER, c.farm.id, { animalId: d.id, event: 'BREACH' }); // demo telemetry, alert, signal events
    expect(c.prisma.tables.alert.some((a) => a.isDemo)).toBe(true);
    expect(c.prisma.tables.signalEvent.length).toBeGreaterThan(1);

    await c.sim.setMode(OWNER, c.farm.id, 'REAL');
    expect(c.prisma.tables.animal.map((a) => a.id)).toEqual([real.animal.id]);
    expect(c.prisma.tables.device.map((a) => a.deviceId)).toEqual(['QAM-0001']);
    expect(c.prisma.tables.geofence.map((a) => a.id)).toEqual([real.pen.id]);
    expect(c.prisma.tables.alert.map((a) => a.message)).toEqual(['real']);
    expect(c.prisma.tables.telemetry).toHaveLength(1);
    expect(c.prisma.tables.signalEvent).toHaveLength(1);
    expect(c.prisma.tables.animal[0].isDemo).toBe(false);
  });

  it('a real collar pings normally in MANUAL and AUTO; its data is never marked demo', async () => {
    useFakeClock();
    const c = await build();
    const real = await addReal(c);
    for (const mode of ['MANUAL', 'AUTO'] as const) {
      await c.sim.setMode(OWNER, c.farm.id, mode);
      const device = await c.prisma.device.findUnique({
        where: { deviceId: 'QAM-0001' },
        include: { farm: true, animal: { include: { activeGeofence: true } } },
      });
      jest.setSystemTime(Date.now() + 5000);
      const res = await c.telemetry.processDeviceTelemetry(device, {
        deviceId: 'QAM-0001', timestamp: new Date().toISOString(), latitude: mode === "AUTO" ? 43.6521 : 43.6520, longitude: 51.157, accuracy: 5,
      } as any);
      expect(res.zone).toBe('RED');
    }
    expect(c.prisma.tables.alert.filter((a) => a.animalId === real.animal.id).every((a) => a.isDemo === false)).toBe(true);
    expect(c.prisma.tables.animal.find((a) => a.id === real.animal.id).isDemo).toBe(false);
    expect(c.prisma.tables.telemetry).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------

describe('scenario (pure engine, fixed seed)', () => {
  const L = {
    type: 'Polygon',
    coordinates: [[[51.15, 43.64], [51.16, 43.64], [51.16, 43.644], [51.154, 43.644], [51.154, 43.65], [51.15, 43.65], [51.15, 43.64]]],
  };
  const RECT = rectanglePolygon(43.65, 51.157, 600, 400);
  const geo = new GeofenceService({} as any);

  function run(poly: any, seed: number, speed: number, ticks: number) {
    const pen = PenGeometry.fromPolygon(poly)!;
    const farm = newFarmSim(seed, T0);
    const animals = [...SCRIPTED_ROLES, null, null].map((r) => newAnimalSim(pen, farm.rng, r, speed));
    const zones = new Set<string>();
    let grazeOutside = 0;
    let grazePings = 0;
    for (let t = 0; t < ticks; t++) {
      const now = T0 + t * 10_000;
      for (const a of animals) {
        const out = stepAnimal(a, pen, farm, now, { speed, tickSec: 10, offlineSec: 90 });
        if (!out.ping) continue;
        const g = pen.toGeo(out.ping.pos);
        const ev = geo.evaluateLocation({ ...g, accuracy: out.ping.accuracy, speed: out.ping.speedKmh }, poly);
        zones.add(ev.zone);
        if (out.phase === 'GRAZE') {
          grazePings++;
          if (!geo.isPointInPolygon(g, poly)) grazeOutside++;
        }
      }
    }
    return { zones, grazeOutside, grazePings };
  }

  it.each([['rectangle', RECT, 1], ['L-shaped (non-convex)', L, 1], ['rectangle at x10', RECT, 10], ['L-shaped at x5', L, 5]])(
    '%s: every zone appears, every GRAZE point is inside the polygon',
    (_n, poly, speed) => {
      const r = run(poly, 12345, speed as number, 600);
      for (const z of ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'ESCAPE', 'UNKNOWN']) expect(r.zones).toContain(z);
      expect(r.grazePings).toBeGreaterThan(100);
      expect(r.grazeOutside).toBe(0);
    },
  );

  it('the same seed gives the same walk', () => {
    const a = run(RECT, 7, 1, 120);
    const b = run(RECT, 7, 1, 120);
    expect([...a.zones].sort()).toEqual([...b.zones].sort());
    expect(a.grazePings).toBe(b.grazePings);
  });

  it('a pen that is invalid or missing is skipped, never guessed', () => {
    expect(PenGeometry.fromPolygon(null)).toBeNull();
    expect(PenGeometry.fromPolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] })).toBeNull();
  });

  it('restores a walker at its last inside position after a restart', () => {
    const pen = PenGeometry.fromPolygon(RECT)!;
    const a = restoreAnimalSim(pen, newFarmSim(1, T0).rng, { x: 0, y: 0 });
    expect(a.phase).toBe('GRAZE');
    expect(a.pos).toEqual({ x: 0, y: 0 });
    const b = restoreAnimalSim(pen, newFarmSim(1, T0).rng, { x: 5000, y: 0 });
    expect(pen.inside(b.pos)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

describe('AUTO simulator through the real pipeline', () => {
  async function auto(over: { herd?: number; hours?: number; speed?: number } = {}) {
    useFakeClock();
    const c = await build();
    const zones = new Set<string>();
    const orig = c.telemetry.processDeviceTelemetry.bind(c.telemetry);
    jest.spyOn(c.telemetry, 'processDeviceTelemetry').mockImplementation(async (d: any, dto: any) => {
      const r = await orig(d, dto);
      zones.add(r.zone);
      return r;
    });
    await c.sim.start(OWNER, c.farm.id, over);
    let t = T0;
    const run = async (n: number, step = 10_000) => {
      let last: any;
      for (let i = 0; i < n; i++) {
        jest.setSystemTime(t);
        c.simulator.markViewed(c.farm.id, t);
        last = await c.simulator.tick(new Date(t));
        t += step;
      }
      return last;
    };
    return { c, zones, run, now: () => t };
  }

  it('the first minutes show every key event: all zones, breach, return, GPS lost, offline, restored', async () => {
    const { c, zones, run } = await auto();
    await run(22); // 3 min 40 s at 10 s per tick
    for (const z of ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'ESCAPE', 'UNKNOWN']) expect(zones).toContain(z);
    const types = alertTypes(c);
    for (const t of ['GEOFENCE_BREACH', 'GEOFENCE_RETURN', 'GPS_LOST', 'DEVICE_OFFLINE', 'DEVICE_RESTORED']) expect(types).toContain(t);
    expect(c.prisma.tables.alert.every((a) => a.isDemo)).toBe(true);
    expect(c.prisma.tables.telemetry.every((x) => x.deviceId.startsWith('QAM-DEMO-'))).toBe(true);
  });

  it('is deterministic enough to repeat: the same start gives the same alert set', async () => {
    const a = await auto();
    await a.run(22);
    const first = [...new Set(alertTypes(a.c))].sort().join();
    jest.useRealTimers();
    const b = await auto();
    await b.run(22);
    expect([...new Set(alertTypes(b.c))].sort().join()).toBe(first);
  });

  it('3 h of simulated time stay within the limits; no lease is left hanging', async () => {
    const { c, run } = await auto({ hours: 4 });
    const last = await run(1080); // 3 h
    expect(last.pings).toBeGreaterThan(0);
    const demoTelemetry = c.prisma.tables.telemetry.length;
    expect(demoTelemetry).toBeLessThanOrEqual(8 * (35 * 6 + 2)); // 30 min kept + up to 5 min between cleanups
    expect(c.prisma.tables.alert.filter((a) => a.isDemo).length).toBeLessThanOrEqual(DEMO_ALERT_MAX);
    const farm = c.prisma.tables.farm[0];
    expect(farm.simLeaseUntil).toBeNull();
    expect(farm.dataMode).toBe('AUTO');
    // signal events older than 2 h are gone
    const oldest = Math.min(...c.prisma.tables.signalEvent.map((s) => +s.at), Infinity);
    expect(oldest).toBeGreaterThanOrEqual(T0 + 3 * 3600_000 - 2 * 3600_000 - 5 * 60_000);
  });

  it('auto-stop after the planned time: MANUAL, demo data stays', async () => {
    const { c, run, now } = await auto(); // default 2 h
    await run(2);
    jest.setSystemTime(T0 + 2 * 3600_000 + 1000);
    c.simulator.markViewed(c.farm.id, Date.now());
    await c.simulator.tick(new Date());
    const farm = c.prisma.tables.farm[0];
    expect(farm).toMatchObject({ dataMode: 'MANUAL', simUntil: null });
    expect(c.prisma.tables.animal.filter((a) => a.isDemo)).toHaveLength(8);
    const st = await c.sim.getState(OWNER, c.farm.id);
    expect(st).toMatchObject({ dataMode: 'MANUAL', running: false });
    expect(now()).toBeGreaterThan(T0);
  });

  it('a read after the planned time also stops the simulation', async () => {
    const { c } = await auto({ hours: 1 });
    jest.setSystemTime(T0 + 3600_000 + 5);
    const st = await c.sim.getState(WORKER, c.farm.id);
    expect(st).toMatchObject({ dataMode: 'MANUAL', running: false, until: null });
  });

  it('nobody watching for more than 3 min: not a single database call, nothing written', async () => {
    const { c, run } = await auto();
    await run(3);
    const calls = c.prisma.calls;
    const telemetry = c.prisma.tables.telemetry.length;
    jest.setSystemTime(Date.now() + VIEW_TTL_MS + 1000);
    const stats = await c.simulator.tick(new Date());
    expect(stats.skippedNoViewer).toBe(true);
    expect(c.prisma.calls).toBe(calls);
    expect(c.prisma.tables.telemetry).toHaveLength(telemetry);
    // a GET marks the farm as watched again and the next tick writes
    await c.sim.getState(OWNER, c.farm.id);
    const again = await c.simulator.tick(new Date());
    expect(again.pings).toBeGreaterThan(0);
  });

  it('a farm that is not AUTO costs one read and writes nothing', async () => {
    const { c, run } = await auto();
    await run(2);
    await c.sim.stop(OWNER, c.farm.id);
    c.simulator.markViewed(c.farm.id, Date.now());
    const telemetry = c.prisma.tables.telemetry.length;
    const stats = await c.simulator.tick(new Date());
    expect(stats.farms).toBe(0);
    expect(c.prisma.tables.telemetry).toHaveLength(telemetry);
  });

  it('a held lease blocks the tick; an expired one does not; the lease is released afterwards', async () => {
    const { c, run } = await auto();
    await run(1);
    await c.prisma.farm.updateMany({ where: {}, data: { simLeaseUntil: new Date(Date.now() + 25_000) } });
    c.simulator.markViewed(c.farm.id, Date.now());
    const blocked = await c.simulator.tick(new Date());
    expect(blocked.farms).toBe(0);
    expect(c.prisma.tables.farm[0].simLeaseUntil).not.toBeNull(); // not ours: left alone
    await c.prisma.farm.updateMany({ where: {}, data: { simLeaseUntil: new Date(Date.now() - 1) } });
    const ok = await c.simulator.tick(new Date());
    expect(ok.farms).toBe(1);
    expect(c.prisma.tables.farm[0].simLeaseUntil).toBeNull();
  });

  it('reset clears demo alerts and history and puts the herd back inside the pen', async () => {
    const { c, run } = await auto();
    await run(20);
    expect(c.prisma.tables.alert.length).toBeGreaterThan(0);
    await c.sim.reset(OWNER, c.farm.id);
    expect(c.prisma.tables.alert).toHaveLength(0);
    expect(c.prisma.tables.telemetry).toHaveLength(0);
    expect(c.prisma.tables.animal.every((a) => a.isOutsideGeofence === false)).toBe(true);
    const pen = PenGeometry.fromPolygon(c.prisma.tables.geofence[0].polygonJson)!;
    for (const a of c.prisma.tables.animal) {
      expect(pen.inside(pen.toLocal(a.lastLatitude, a.lastLongitude))).toBe(true);
    }
  });

  it('measurement: database calls and time per tick at 8 and 20 animals (in-memory fake, not a real database)', async () => {
    for (const herd of [8, 20]) {
      const { c, run } = await auto({ herd });
      await run(5); // warm up
      const before = c.prisma.calls;
      const t0 = performance.now();
      const n = 30;
      await run(n);
      const ms = (performance.now() - t0) / n;
      const perTick = (c.prisma.calls - before) / n;
      // eslint-disable-next-line no-console
      console.log(`[measure] herd=${herd}: ${perTick.toFixed(1)} database calls per tick (${(perTick / herd).toFixed(1)} per animal), ${ms.toFixed(1)} ms per tick on the in-memory fake`);
      expect(perTick / herd).toBeLessThan(25);
      jest.useRealTimers();
    }
  });
});

describe('review fixes', () => {
  it('start: the farm switches to AUTO only after the herd exists (a failure leaves the mode as it was)', async () => {
    useFakeClock();
    const c = await build();
    jest.spyOn(c.demo, 'ensureHerd').mockRejectedValueOnce(new Error('boom'));
    await expect(c.sim.start(OWNER, c.farm.id, {})).rejects.toThrow('boom');
    expect(c.prisma.tables.farm[0].dataMode).toBe('REAL');
    expect(c.prisma.tables.farm[0].simLeaseUntil).toBeNull(); // lease released after the failure
    const ok = await c.sim.start(OWNER, c.farm.id, {});
    expect(ok).toMatchObject({ dataMode: 'AUTO', demo: { animals: 8 } });
  });

  it('REAL and start refuse (409) while a tick holds the farm lease; the mode is untouched', async () => {
    useFakeClock();
    const c = await build();
    await c.sim.start(OWNER, c.farm.id, {});
    jest.spyOn(c.simulator, 'acquireLease').mockResolvedValue(false);
    await expect(c.sim.setMode(OWNER, c.farm.id, 'REAL')).rejects.toBeInstanceOf(ConflictException);
    await expect(c.sim.start(OWNER, c.farm.id, {})).rejects.toBeInstanceOf(ConflictException);
    expect(c.prisma.tables.farm[0].dataMode).toBe('AUTO');
    expect(c.prisma.tables.animal.filter((a) => a.isDemo)).toHaveLength(8);
  });

  it('a tick that read a stale AUTO farm cannot take the lease once the farm is REAL, and re-creates nothing', async () => {
    useFakeClock();
    const c = await build();
    await c.sim.start(OWNER, c.farm.id, {});
    const stale = { ...c.prisma.tables.farm[0] };
    await c.sim.setMode(OWNER, c.farm.id, 'REAL');
    expect(c.prisma.tables.animal).toHaveLength(0);
    jest.spyOn(c.prisma.farm, 'findMany').mockResolvedValue([stale]);
    c.simulator.markViewed(c.farm.id, Date.now());
    const stats = await c.simulator.tick(new Date());
    expect(stats.farms).toBe(0);
    expect(c.prisma.tables.animal).toHaveLength(0);
    expect(c.prisma.tables.geofence).toHaveLength(0);
  });

  it('MANUAL farms are trimmed from the state read (24 h TTL); fresh rows and real rows stay', async () => {
    useFakeClock();
    const c = await build();
    const real = await addReal(c);
    await c.sim.setMode(OWNER, c.farm.id, 'MANUAL');
    const d = await c.sim.createAnimal(OWNER, c.farm.id, {});
    const old = new Date(Date.now() - 25 * 3600_000);
    const fresh = new Date(Date.now() - 3600_000);
    const dev = c.prisma.tables.device.find((x) => x.isSimulated).deviceId;
    for (const [ts, tag] of [[old, 'old'], [fresh, 'fresh']] as const) {
      await c.prisma.telemetry.create({ data: { deviceId: dev, animalId: d.id, latitude: 1, longitude: 1, accuracy: 1, timestamp: ts } });
      await c.prisma.alert.create({ data: { farmId: c.farm.id, animalId: d.id, type: 'GPS_LOST', message: tag, isDemo: true, status: 'RESOLVED', resolvedAt: ts } });
    }
    await c.prisma.telemetry.create({ data: { deviceId: 'QAM-0001', animalId: real.animal.id, latitude: 1, longitude: 1, accuracy: 1, timestamp: old } });
    await c.prisma.alert.create({ data: { farmId: c.farm.id, animalId: real.animal.id, type: 'GPS_LOST', message: 'real-old', status: 'RESOLVED', resolvedAt: old } });

    await c.sim.getState(OWNER, c.farm.id);
    expect(c.prisma.tables.alert.map((a) => a.message).sort()).toEqual(['fresh', 'real-old']);
    expect(c.prisma.tables.telemetry.filter((t) => t.deviceId === dev)).toHaveLength(1);
    expect(c.prisma.tables.telemetry.filter((t) => t.deviceId === 'QAM-0001')).toHaveLength(1);
  });

  it('cleanup removes legacy QAM-MOCK-* simulated collars only, never a real collar', async () => {
    useFakeClock();
    const c = await build();
    await c.prisma.device.create({ data: { deviceId: 'QAM-MOCK-T1', secretHash: 'a', farmId: c.farm.id, isSimulated: true } });
    await c.prisma.device.create({ data: { deviceId: 'QAM-MOCK-T2', secretHash: 'b', farmId: c.farm.id, isSimulated: false } });
    await c.simulator.cleanup(c.farm.id, new Date());
    expect(c.prisma.tables.device.map((d) => d.deviceId)).toEqual(['QAM-MOCK-T2']);
  });
});
