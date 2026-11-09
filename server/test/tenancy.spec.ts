import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FarmAccessGuard } from '../src/farms/farm-access.guard';
import { assertSameFarm } from '../src/farms/same-farm';
import { AnimalsService } from '../src/animals/animals.service';
import { GeofenceService } from '../src/geofences/geofence.service';

const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;

function guardWith(memberships: Array<{ farmId: string; role: string }>) {
  const prisma: any = {
    farmMember: {
      findUnique: jest.fn(async ({ where }: any) =>
        memberships.find((m) => m.farmId === where.userId_farmId.farmId) ?? null,
      ),
      findMany: jest.fn(async () => memberships),
    },
  };
  return new FarmAccessGuard(prisma);
}

describe('FarmAccessGuard', () => {
  it('403 for a farm the user is not a member of (header)', async () => {
    const g = guardWith([{ farmId: 'A', role: 'OWNER' }]);
    await expect(g.canActivate(ctx({ user: { id: 'u' }, headers: { 'x-farm-id': 'B' } }))).rejects.toThrow(ForbiddenException);
  });
  it('sets farmId and role for a member', async () => {
    const g = guardWith([{ farmId: 'A', role: 'OWNER' }]);
    const req: any = { user: { id: 'u' }, headers: { 'x-farm-id': 'A' } };
    await expect(g.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.farmId).toBe('A');
    expect(req.memberRole).toBe('OWNER');
  });
  it('single farm is used without a header; two farms without a header -> 400', async () => {
    const one = guardWith([{ farmId: 'A', role: 'WORKER' }]);
    const req: any = { user: { id: 'u' }, headers: {} };
    await expect(one.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.farmId).toBe('A');
    const two = guardWith([{ farmId: 'A', role: 'OWNER' }, { farmId: 'B', role: 'WORKER' }]);
    await expect(two.canActivate(ctx({ user: { id: 'u' }, headers: {} }))).rejects.toThrow(BadRequestException);
  });
  it('403 when the user has no farms', async () => {
    const g = guardWith([]);
    await expect(g.canActivate(ctx({ user: { id: 'u' }, headers: {} }))).rejects.toThrow(ForbiddenException);
  });
});

describe('assertSameFarm', () => {
  const prisma: any = {
    animal: { count: jest.fn(async ({ where }: any) => (where.farmId === 'A' ? (where.id.in ? where.id.in.filter((i: string) => i.startsWith('a')).length : where.id.startsWith('a') ? 1 : 0) : 0)) },
    device: { count: jest.fn(async ({ where }: any) => (where.farmId === 'A' && where.deviceId === 'QAM-1' ? 1 : 0)) },
    geofence: { count: jest.fn(async ({ where }: any) => (where.farmId === 'A' && where.id === 'g1' ? 1 : 0)) },
  };
  it('passes for own entities and no refs', async () => {
    await expect(assertSameFarm(prisma, 'A', {})).resolves.toBeUndefined();
    await expect(assertSameFarm(prisma, 'A', { animalId: 'a1', deviceId: 'QAM-1', geofenceId: 'g1', animalIds: ['a1', 'a2'] })).resolves.toBeUndefined();
  });
  it('404 for foreign animal, device, geofence or any foreign id in animalIds', async () => {
    await expect(assertSameFarm(prisma, 'A', { animalId: 'x1' })).rejects.toThrow(NotFoundException);
    await expect(assertSameFarm(prisma, 'A', { deviceId: 'QAM-2' })).rejects.toThrow(NotFoundException);
    await expect(assertSameFarm(prisma, 'A', { geofenceId: 'g2' })).rejects.toThrow(NotFoundException);
    await expect(assertSameFarm(prisma, 'A', { animalIds: ['a1', 'x1'] })).rejects.toThrow(NotFoundException);
  });
});

describe('AnimalsService / GeofenceService tenancy', () => {
  it('createAnimal rejects a foreign geofence and a foreign collar; never claims it', async () => {
    const prisma: any = {
      animal: { count: jest.fn(async () => 1), findUnique: jest.fn(), create: jest.fn() },
      device: { count: jest.fn(async () => 0), update: jest.fn(), updateMany: jest.fn() },
      geofence: { count: jest.fn(async () => 0) },
    };
    const svc = new AnimalsService(prisma);
    await expect(
      svc.createAnimal('u', 'A', { name: 'n', tag: 't', species: 'CATTLE', penId: 'foreign' } as any),
    ).rejects.toThrow(NotFoundException);
    prisma.geofence.count.mockResolvedValue(1);
    await expect(
      svc.createAnimal('u', 'A', { name: 'n', tag: 't', species: 'CATTLE', collarId: 'QAM-B' } as any),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.animal.create).not.toHaveBeenCalled();
    expect(prisma.device.update).not.toHaveBeenCalled();
  });

  it('tag uniqueness is per farm', async () => {
    const prisma: any = {
      farm: { findUnique: jest.fn(async () => ({ dataMode: 'REAL' })) },
      animal: { count: jest.fn(), findUnique: jest.fn(async () => ({ id: 'x' })), create: jest.fn() },
      device: { count: jest.fn() },
      geofence: { count: jest.fn() },
    };
    const svc = new AnimalsService(prisma);
    await expect(svc.createAnimal('u', 'A', { name: 'n', tag: 't', species: 'CATTLE' } as any)).rejects.toThrow(/уже/);
    expect(prisma.animal.findUnique).toHaveBeenCalledWith({ where: { farmId_tagNumber: { farmId: 'A', tagNumber: 't' } } });
  });

  it('geofence create with foreign animalIds is rejected (404) before anything is written', async () => {
    const prisma: any = {
      animal: { count: jest.fn(async () => 0), updateMany: jest.fn() },
      geofence: { create: jest.fn() },
    };
    const svc = new GeofenceService(prisma);
    await expect(
      svc.createGeofence('u', 'A', { name: 'g', polygon: { type: 'Polygon', coordinates: [] }, animalIds: ['b1'] } as any),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.geofence.create).not.toHaveBeenCalled();
    expect(prisma.animal.updateMany).not.toHaveBeenCalled();
  });
});
