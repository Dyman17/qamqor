import { ForbiddenException } from '@nestjs/common';
import { MockService } from '../src/mock/mock.service';

describe('MockService isolation', () => {
  it('refuses to inject telemetry into a real (non-simulated) collar', async () => {
    const telemetry: any = { processDeviceTelemetry: jest.fn() };
    const prisma: any = {
      farmMember: { findUnique: jest.fn(async () => ({})) },
      animal: {
        findFirst: jest.fn(async () => ({
          id: 'a', tagNumber: 'T-1', device: { id: 'd', deviceId: 'QAM-0001', isSimulated: false },
        })),
      },
      device: { upsert: jest.fn(), findUnique: jest.fn() },
    };
    const svc = new MockService(prisma, telemetry);
    await expect(svc.injectManualTelemetry('u', 'f', { animalId: 'a', latitude: 1, longitude: 1 } as any)).rejects.toThrow(ForbiddenException);
    expect(telemetry.processDeviceTelemetry).not.toHaveBeenCalled();
    expect(prisma.device.upsert).not.toHaveBeenCalled();
  });

  it('refuses to reuse a real device whose id collides with a mock id', async () => {
    const prisma: any = {
      farmMember: { findUnique: jest.fn(async () => ({})) },
      animal: { findFirst: jest.fn(async () => ({ id: 'a', tagNumber: 'T-1', device: null })) },
      device: { upsert: jest.fn(), findUnique: jest.fn(async () => ({ isSimulated: false })) },
    };
    const svc = new MockService(prisma, {} as any);
    await expect(svc.injectManualTelemetry('u', 'f', { animalId: 'a', latitude: 1, longitude: 1 } as any)).rejects.toThrow(ForbiddenException);
    expect(prisma.device.upsert).not.toHaveBeenCalled();
  });
});
