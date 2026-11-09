import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { GeofenceService } from '../src/geofences/geofence.service';
import { DeviceTelemetryDto } from '../src/telemetry/dto/device-telemetry.dto';
import { toAnimalDto } from '../src/animals/mappers';
import { heartRateFor } from '../src/simulation/scenario';

const poly = {
  type: 'Polygon',
  coordinates: [[[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]],
};

function setup(dataMode: string) {
  const prisma: any = {
    animal: { update: jest.fn() },
    device: { update: jest.fn() },
    telemetry: { create: jest.fn(), findFirst: jest.fn(async () => null) },
    deviceCommand: { findFirst: jest.fn(async () => null), updateMany: jest.fn() },
  };
  const alerts: any = { triggerGeofenceBreach: jest.fn(), resolveGeofenceBreach: jest.fn(), triggerGpsLost: jest.fn(), resolveGpsLost: jest.fn(), restoreDevice: jest.fn() };
  const signals: any = { applyLimits: jest.fn(async (a: any) => ({ sound: a.sound, vibrate: a.vibrate, suppressed: false })) };
  const svc = new TelemetryService(prisma, new GeofenceService({} as any), alerts, { get: (_k: string, d: string) => d } as any, signals);
  const device: any = {
    id: 'd1', deviceId: 'QAM-0001', farmId: 'f1', farm: { dataMode },
    animal: { id: 'a1', name: 'A', isOutsideGeofence: false, activeGeofence: { polygonJson: poly } },
  };
  return { svc, prisma, device };
}
const dto = (extra: any = {}): any => ({ deviceId: 'QAM-0001', timestamp: new Date().toISOString(), latitude: 43.65, longitude: 51.157, accuracy: 5, ...extra });

describe('heart rate and mode', () => {
  it('stores heart rate on the row and the animal, and reports the mode', async () => {
    const { svc, prisma, device } = setup('MANUAL');
    const res: any = await svc.processDeviceTelemetry(device, dto({ heartRate: 64, satellites: 8 }));
    expect(res.mode).toBe('PILOT');
    expect(prisma.telemetry.create.mock.calls[0][0].data).toMatchObject({ heartRate: 64, satellites: 8 });
    expect(prisma.animal.update.mock.calls[0][0].data).toMatchObject({ lastHeartRate: 64 });
    expect(prisma.animal.update.mock.calls[0][0].data.lastHeartRateAt).toBeInstanceOf(Date);
  });

  it('null heart rate does not overwrite the last value', async () => {
    const { svc, prisma, device } = setup('REAL');
    const res: any = await svc.processDeviceTelemetry(device, dto({ heartRate: null }));
    expect(res.mode).toBe('REAL');
    expect(prisma.telemetry.create.mock.calls[0][0].data.heartRate).toBeNull();
    expect(prisma.animal.update.mock.calls[0][0].data).not.toHaveProperty('lastHeartRate');
  });

  it('maps AUTO', async () => {
    const { svc, device } = setup('AUTO');
    expect(((await svc.processDeviceTelemetry(device, dto())) as any).mode).toBe('AUTO');
  });

  it('validates the range', async () => {
    const mk = (hr: any) => plainToInstance(DeviceTelemetryDto, { timestamp: new Date().toISOString(), latitude: 1, longitude: 1, accuracy: 5, heartRate: hr });
    expect(await validate(mk(72))).toHaveLength(0);
    expect(await validate(mk(null))).toHaveLength(0);
    expect(await validate(mk(19))).not.toHaveLength(0);
    expect(await validate(mk(251))).not.toHaveLength(0);
    expect(await validate(mk(70.5))).not.toHaveLength(0);
  });

  it('exposes it in AnimalDto', () => {
    const at = new Date('2026-11-09T08:00:00Z');
    const d = toAnimalDto({ id: 'a', farmId: 'f', lastHeartRate: 70, lastHeartRateAt: at });
    expect(d.lastHeartRate).toBe(70);
    expect(d.lastHeartRateAt).toBe(at.toISOString());
    expect(toAnimalDto({ id: 'a', farmId: 'f' }).lastHeartRate).toBeNull();
  });

  it('simulator pulse stays in 48..84 and is higher when escaping', () => {
    let calm = 0, esc = 0;
    for (let i = 0; i < 500; i++) {
      const c = heartRateFor('GRAZE'), e = heartRateFor('BREAKOUT');
      expect(c).toBeGreaterThanOrEqual(48); expect(e).toBeLessThanOrEqual(84);
      calm += c; esc += e;
    }
    expect(esc).toBeGreaterThan(calm);
  });

  describe('pulse-only ping (no GPS fix)', () => {
    const pulseOnly = (extra: any = {}): any => ({ deviceId: 'QAM-0001', heartRate: 66, satellites: 0, ...extra });

    it('answers UNKNOWN with mode, no signals, stores only the pulse', async () => {
      const { svc, prisma, device } = setup('MANUAL');
      const res: any = await svc.processDeviceTelemetry(device, pulseOnly());
      expect(res).toMatchObject({ success: true, mode: 'PILOT', zone: 'UNKNOWN', inFence: null, sound: false, vibrate: false, nextInterval: 300 });
      expect(prisma.device.update).toHaveBeenCalled();
      const upd = prisma.animal.update.mock.calls[0][0].data;
      expect(upd).toMatchObject({ lastHeartRate: 66 });
      expect(upd).not.toHaveProperty('lastLatitude');
      expect(upd).not.toHaveProperty('lastSeenAt');
      expect(prisma.telemetry.create.mock.calls[0][0].data).toMatchObject({ heartRate: 66, latitude: null, longitude: null, accuracy: null });
    });

    it('null pulse and no fix is still a heartbeat', async () => {
      const { svc, prisma, device } = setup('REAL');
      const res: any = await svc.processDeviceTelemetry(device, pulseOnly({ heartRate: null }));
      expect(res.mode).toBe('REAL');
      expect(prisma.animal.update).not.toHaveBeenCalled();
      expect(prisma.device.update).toHaveBeenCalled();
    });

    it('validation: pulse-only passes, half coordinates fail, coordinates need a timestamp', async () => {
      const mk = (o: any) => plainToInstance(DeviceTelemetryDto, o);
      expect(await validate(mk({ code: '12345678', heartRate: 70, satellites: 0 }))).toHaveLength(0);
      expect(await validate(mk({ code: '12345678', heartRate: null }))).toHaveLength(0);
      const ts = new Date().toISOString();
      expect(await validate(mk({ timestamp: ts, latitude: 43.6 }))).not.toHaveLength(0);
      expect(await validate(mk({ timestamp: ts, latitude: 43.6, longitude: 51.1 }))).not.toHaveLength(0); // accuracy missing
      expect(await validate(mk({ latitude: 43.6, longitude: 51.1, accuracy: 5 }))).not.toHaveLength(0); // timestamp missing
      expect(await validate(mk({ timestamp: ts, latitude: 143.6, longitude: 51.1, accuracy: 5 }))).not.toHaveLength(0);
      expect(await validate(mk({ timestamp: ts, latitude: 43.6, longitude: 51.1, accuracy: 5 }))).toHaveLength(0);
    });
  });
});

describe('unclaimed device telemetry', () => {
  it('stores the ping, replies UNKNOWN/REAL with the not-claimed message, no signals', async () => {
    const { svc, prisma } = setup('REAL');
    const un = { id: 'u1', deviceId: 'QAM-87654321', code: '87654321', farmId: null, farm: null, animal: null };
    const res: any = await svc.processDeviceTelemetry(un, { ...dto({ heartRate: 70 }), deviceId: 'QAM-87654321' });
    expect(res).toMatchObject({ success: true, mode: 'REAL', zone: 'UNKNOWN', sound: false, vibrate: false, nextInterval: 300, warningMessage: 'Device not claimed yet' });
    expect(prisma.telemetry.create.mock.calls[0][0].data).toMatchObject({ deviceId: 'QAM-87654321', heartRate: 70 });
    expect(prisma.device.update).toHaveBeenCalled();
    expect(prisma.animal.update).not.toHaveBeenCalled();
  });
});
