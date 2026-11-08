import { Reflector } from '@nestjs/core';
import { ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { PermissionsGuard } from '../src/farms/permissions.guard';
import { FARM_ROLES_KEY, BOUNDARY_EDIT_KEY } from '../src/farms/roles.decorator';
import { FarmAccessGuard } from '../src/farms/farm-access.guard';
import { FarmsService } from '../src/farms/farms.service';
import { parseSignalLimits, effectiveLimit } from '../src/farms/signal-limits';
import { AnimalsController } from '../src/animals/animals.controller';
import { AnimalsService } from '../src/animals/animals.service';
import { GeofenceController } from '../src/geofences/geofence.controller';
import { DevicesController } from '../src/devices/devices.controller';
import { MockController } from '../src/mock/mock.controller';
import { AlertsController } from '../src/alerts/alerts.controller';
import { AnalyticsController } from '../src/analytics/analytics.controller';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateFarmDto } from '../src/farms/dto/farm.dto';

const reflector = new Reflector();
const guard = new PermissionsGuard(reflector);

function run(handler: Function, cls: Function, req: any) {
  const ctx: any = {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req }),
  };
  return guard.canActivate(ctx);
}
const proto = (c: any, name: string) => c.prototype[name];
const owner = { memberRole: 'OWNER', canEditBoundaries: true };
const workerOff = { memberRole: 'WORKER', canEditBoundaries: false };
const workerOn = { memberRole: 'WORKER', canEditBoundaries: true };

describe('PermissionsGuard x route matrix', () => {
  const ownerOnly: Array<[any, string]> = [
    [GeofenceController, 'deleteGeofence'],
    [DevicesController, 'deleteDevice'],
  ];
  const boundary: Array<[any, string]> = [
    [GeofenceController, 'createGeofence'],
    [GeofenceController, 'updateGeofence'],
  ];
  const open: Array<[any, string]> = [
    [AnimalsController, 'listAnimals'],
    [AnimalsController, 'updateAnimal'],
    [AnimalsController, 'createAnimal'],
    [AnimalsController, 'deleteAnimal'],
    [DevicesController, 'registerDevice'],
    [DevicesController, 'updateDevice'],
    [DevicesController, 'testSignal'],
    [GeofenceController, 'listGeofences'],
    [AlertsController, 'listAlerts'],
    [AlertsController, 'updateStatus'],
    [AnalyticsController, 'getOverview'],
    [MockController, 'injectTelemetry'],
  ];

  it.each(ownerOnly)('%p.%s: owner only', (cls, name) => {
    expect(run(proto(cls, name), cls, owner)).toBe(true);
    expect(() => run(proto(cls, name), cls, workerOn)).toThrow(ForbiddenException);
    expect(() => run(proto(cls, name), cls, workerOff)).toThrow(ForbiddenException);
  });

  it.each(boundary)('%p.%s: owner, or worker with the switch on', (cls, name) => {
    expect(run(proto(cls, name), cls, owner)).toBe(true);
    expect(run(proto(cls, name), cls, workerOn)).toBe(true);
    expect(() => run(proto(cls, name), cls, workerOff)).toThrow(ForbiddenException);
    expect(Reflect.getMetadata(BOUNDARY_EDIT_KEY, proto(cls, name))).toBe(true);
  });

  it.each(open)('%p.%s: any member', (cls, name) => {
    for (const r of [owner, workerOff, workerOn]) expect(run(proto(cls, name), cls, r)).toBe(true);
    expect(Reflect.getMetadata(FARM_ROLES_KEY, proto(cls, name))).toBeUndefined();
  });

  it('error carries code FORBIDDEN_ROLE', () => {
    let err: any;
    try {
      run(proto(GeofenceController, 'deleteGeofence'), GeofenceController, workerOn);
    } catch (e) {
      err = e;
    }
    expect(err.getResponse().code).toBe('FORBIDDEN_ROLE');
  });
});

describe('FarmAccessGuard boundary switch', () => {
  const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;
  const mk = (role: string, flag: boolean) =>
    new FarmAccessGuard({
      farmMember: {
        findUnique: jest.fn(async () => ({ farmId: 'A', role, farm: { workerCanEditBoundaries: flag } })),
        findMany: jest.fn(),
      },
    } as any);

  it('worker: canEditBoundaries follows the switch (default false); owner always true', async () => {
    const mkReq = () => ({ user: { id: 'u' }, headers: { 'x-farm-id': 'A' } }) as any;
    let r = mkReq();
    await mk('WORKER', false).canActivate(ctx(r));
    expect(r.canEditBoundaries).toBe(false);
    r = mkReq();
    await mk('WORKER', true).canActivate(ctx(r));
    expect(r.canEditBoundaries).toBe(true);
    r = mkReq();
    await mk('OWNER', false).canActivate(ctx(r));
    expect(r.canEditBoundaries).toBe(true);
  });
});

describe('Animals: assigning a pen needs boundary rights', () => {
  it('worker without the switch cannot set activeGeofenceId on create/update', async () => {
    const prisma: any = { animal: { findFirst: jest.fn(async () => ({ id: 'a1', tagNumber: 't' })) } };
    const svc = new AnimalsService(prisma);
    await expect(
      svc.createAnimal('u', 'A', { name: 'n', tagNumber: 't', species: 'CATTLE', activeGeofenceId: 'g' } as any, false),
    ).rejects.toThrow(ForbiddenException);
    await expect(svc.updateAnimal('u', 'A', 'a1', { activeGeofenceId: null } as any, false)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('FarmsService', () => {
  function svcWith() {
    const prisma: any = {
      farmMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        delete: jest.fn(),
        create: jest.fn(),
      },
      farm: {
        create: jest.fn(async ({ data }: any) => ({ id: 'F', workerCanEditBoundaries: false, timezone: 'Asia/Aqtau', ...data })),
        update: jest.fn(),
      },
      signalLimit: { findMany: jest.fn(async () => []), upsert: jest.fn((x: any) => x) },
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    return { prisma, svc: new FarmsService(prisma) };
  }

  it('POST /farms denied for a user who owns no farm (worker)', async () => {
    const { svc, prisma } = svcWith();
    await expect(svc.createFarm('w', { name: 'x' } as any)).rejects.toThrow(ForbiddenException);
    expect(prisma.farm.create).not.toHaveBeenCalled();
  });

  it('owner creates a farm: OWNER membership, switch off by default, Aqtau timezone', async () => {
    const { svc, prisma } = svcWith();
    prisma.farmMember.count.mockResolvedValue(1);
    const f = await svc.createFarm('o', { name: 'x' } as any);
    expect(f).toMatchObject({ myRole: 'OWNER', workerCanEditBoundaries: false, timezone: 'Asia/Aqtau' });
    expect(prisma.farmMember.create).toHaveBeenCalledWith({ data: expect.objectContaining({ role: 'OWNER' }) });
  });

  it('PATCH farm, members and signal limits: worker denied, owner allowed', async () => {
    const { svc, prisma } = svcWith();
    prisma.farmMember.findUnique.mockResolvedValue({ role: 'WORKER', farm: {} });
    await expect(svc.updateFarm('w', 'F', { workerCanEditBoundaries: true })).rejects.toThrow(ForbiddenException);
    await expect(svc.getSignalLimits('w', 'F')).rejects.toThrow(ForbiddenException);
    await expect(svc.listMembers('w', 'F')).rejects.toThrow(ForbiddenException);
    prisma.farmMember.findUnique.mockResolvedValue({ role: 'OWNER', farm: { id: 'F' } });
    prisma.farm.update.mockResolvedValue({ id: 'F', timezone: 'Asia/Aqtau', workerCanEditBoundaries: true });
    await expect(svc.updateFarm('o', 'F', { workerCanEditBoundaries: true })).resolves.toMatchObject({
      workerCanEditBoundaries: true,
    });
    const lim = await svc.getSignalLimits('o', 'F');
    expect(lim).toEqual([
      { level: 'SOUND', dailyLimit: null, unlimited: false },
      { level: 'VIBRATION', dailyLimit: null, unlimited: false },
      { level: 'IMPULSE', dailyLimit: null, unlimited: false },
    ]);
  });

  it('non-member gets FORBIDDEN_FARM', async () => {
    const { svc } = svcWith();
    let err: any;
    try {
      await svc.getFarmById('x', 'F');
    } catch (e) {
      err = e;
    }
    expect(err.getResponse().code).toBe('FORBIDDEN_FARM');
  });

  it('the owner cannot be removed; a worker can', async () => {
    const { svc, prisma } = svcWith();
    prisma.farmMember.findUnique
      .mockResolvedValueOnce({ role: 'OWNER', farm: { ownerId: 'o' } })
      .mockResolvedValueOnce({ id: 'm1', role: 'OWNER' });
    await expect(svc.removeMember('o', 'F', 'o')).rejects.toThrow(ConflictException);
    prisma.farmMember.findUnique
      .mockResolvedValueOnce({ role: 'OWNER', farm: { ownerId: 'o' } })
      .mockResolvedValueOnce({ id: 'm2', role: 'WORKER' });
    await svc.removeMember('o', 'F', 'w');
    expect(prisma.farmMember.delete).toHaveBeenCalledWith({ where: { id: 'm2' } });
  });
});

describe('signal limits validation', () => {
  it('accepts null / integer >= 1 / unlimited', () => {
    expect(
      parseSignalLimits([
        { level: 'SOUND', dailyLimit: 3 },
        { level: 'VIBRATION', dailyLimit: null, unlimited: true },
      ]),
    ).toEqual([
      { level: 'SOUND', dailyLimit: 3, unlimited: false },
      { level: 'VIBRATION', dailyLimit: null, unlimited: true },
    ]);
  });
  it.each([0, -1, 1.5, '3', 100000])('rejects dailyLimit %p', (v) => {
    expect(() => parseSignalLimits([{ level: 'SOUND', dailyLimit: v }])).toThrow(BadRequestException);
  });
  it('rejects bad level, duplicates, non-array, extra fields', () => {
    expect(() => parseSignalLimits([{ level: 'SHOCK', dailyLimit: 1 }])).toThrow(BadRequestException);
    expect(() => parseSignalLimits([{ level: 'SOUND' }, { level: 'SOUND' }])).toThrow(BadRequestException);
    expect(() => parseSignalLimits({})).toThrow(BadRequestException);
    expect(() => parseSignalLimits([{ level: 'SOUND', foo: 1 }])).toThrow(BadRequestException);
  });
  it('effectiveLimit: null when unset or unlimited', () => {
    expect(effectiveLimit(null)).toBeNull();
    expect(effectiveLimit({ dailyLimit: 2, unlimited: true })).toBeNull();
    expect(effectiveLimit({ dailyLimit: 2, unlimited: false })).toBe(2);
  });
});

describe('UpdateFarmDto', () => {
  it('validates timezone and boolean switch', async () => {
    expect((await validate(plainToInstance(UpdateFarmDto, { timezone: 'Asia/Aqtau', workerCanEditBoundaries: true }))).length).toBe(0);
    expect((await validate(plainToInstance(UpdateFarmDto, { timezone: 'Mars/Base' }))).length).toBe(1);
    expect((await validate(plainToInstance(UpdateFarmDto, { workerCanEditBoundaries: 'yes' }))).length).toBe(1);
  });
});
