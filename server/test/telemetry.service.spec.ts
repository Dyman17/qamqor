import { UnauthorizedException } from '@nestjs/common';
import { TelemetryService } from '../src/telemetry/telemetry.service';
import { GeofenceService } from '../src/geofences/geofence.service';

const poly = {
  type: 'Polygon',
  coordinates: [[[51.15, 43.645], [51.165, 43.645], [51.165, 43.655], [51.15, 43.655], [51.15, 43.645]]],
};

function setup(pendingCommand: any = null) {
  const prisma: any = {
    animal: { update: jest.fn() },
    device: { update: jest.fn(), create: jest.fn() },
    telemetry: { create: jest.fn() },
    deviceCommand: {
      findFirst: jest.fn(async () => pendingCommand),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const alerts: any = { triggerGeofenceBreach: jest.fn(), resolveGeofenceBreach: jest.fn() };
  const config: any = { get: (_k: string, d: string) => d };
  const svc = new TelemetryService(prisma, new GeofenceService({} as any), alerts, config);
  const device: any = {
    id: 'd1', deviceId: 'QAM-0001', farmId: 'f1',
    animal: { id: 'a1', name: 'A', isOutsideGeofence: false, activeGeofence: { polygonJson: poly } },
  };
  return { svc, prisma, device };
}

const dto = (lat: number, lng: number): any => ({
  deviceId: 'QAM-0001', timestamp: new Date().toISOString(), latitude: lat, longitude: lng, accuracy: 5,
});

describe('TelemetryService (device already authenticated)', () => {
  it('rejects a device mismatch and never creates devices', async () => {
    const { svc, prisma, device } = setup();
    await expect(svc.processDeviceTelemetry(device, { ...dto(43.65, 51.157), deviceId: 'OTHER' })).rejects.toThrow(UnauthorizedException);
    await expect(svc.processDeviceTelemetry(null, dto(43.65, 51.157))).rejects.toThrow(UnauthorizedException);
    expect(prisma.device.create).not.toHaveBeenCalled();
  });

  it('never returns shock fields or voltage text, in any zone', async () => {
    for (const [lat, lng] of [[43.65, 51.157], [43.6552, 51.157], [43.6546, 51.157], [43.66, 51.157], [43.7, 51.157]]) {
      const { svc, device } = setup();
      const res: any = await svc.processDeviceTelemetry(device, dto(lat, lng));
      expect(res).not.toHaveProperty('shock');
      expect(res).not.toHaveProperty('shockDurationMs');
      expect(res).not.toHaveProperty('buzzer');
      expect(res.warningMessage).not.toMatch(/кВ|kV|шок|shock/i);
    }
  });

  it('RED zone = sound + vibration only', async () => {
    const { svc, device } = setup();
    const res: any = await svc.processDeviceTelemetry(device, dto(43.6552, 51.157));
    expect(res.zone).toBe('RED');
    expect(res.sound).toBe(true);
    expect(res.vibrate).toBe(true);
  });

  it('delivers a queued test signal once', async () => {
    const { svc, prisma, device } = setup({ id: 'c1', command: 'TEST_SOUND' });
    const res: any = await svc.processDeviceTelemetry(device, dto(43.65, 51.157));
    expect(res.command).toEqual({ id: 'c1', type: 'TEST_SOUND' });
    expect(prisma.deviceCommand.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', status: 'PENDING' } }),
    );
    const none = setup(null);
    const res2: any = await none.svc.processDeviceTelemetry(none.device, dto(43.65, 51.157));
    expect(res2.command).toBeUndefined();
  });
});
