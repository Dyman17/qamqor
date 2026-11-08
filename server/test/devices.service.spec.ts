import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DevicesService, toCollarDto } from '../src/devices/devices.service';
import { TestSignalDto } from '../src/devices/dto/device.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

function makePrisma() {
  const rows: any[] = [];
  return {
    rows,
    farmMember: { findUnique: jest.fn(async () => ({ role: 'OWNER' })) },
    animal: { findFirst: jest.fn(async () => null) },
    deviceCommand: { create: jest.fn(async ({ data }: any) => ({ id: 'cmd-1', ...data })) },
    device: {
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.deviceId === where.deviceId) ?? null),
      findFirst: jest.fn(async ({ where }: any) =>
        where.OR
          ? rows.find((r) => where.OR.some((c: any) => Object.entries(c).every(([k, v]) => r[k] === v))) ?? null
          : rows.find((r) => r.deviceId === where.deviceId && r.farmId === where.farmId) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.farmId === where.farmId)),
      create: jest.fn(async ({ data }: any) => {
        const r = { id: 'id-' + rows.length, lastHeartbeatAt: null, signal: null, animal: null, ...data };
        rows.push(r);
        return r;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
    },
  };
}

describe('DevicesService', () => {
  it('returns deviceSecret once on create, stores only the hash, never leaks it in DTO', async () => {
    const prisma = makePrisma();
    const svc = new DevicesService(prisma as any);
    const res: any = await svc.registerDevice('u', 'f', { deviceId: 'QAM-0001' } as any);
    expect(res.deviceSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(res.collar)).not.toMatch(/secret|hash/i);
    expect(prisma.rows[0].secretHash).not.toBe(res.deviceSecret);
    const list = await svc.listDevices('u', 'f');
    expect(JSON.stringify(list)).not.toMatch(/secret|hash/i);
    const one = await svc.getDeviceById('u', 'f', 'QAM-0001');
    expect(JSON.stringify(one)).not.toMatch(/secret|hash/i);
    const rot: any = await svc.rotateSecret('u', 'f', 'QAM-0001');
    expect(rot.deviceSecret).not.toBe(res.deviceSecret);
    expect(Object.keys(rot)).toEqual(['deviceSecret']);
  });

  it('claims a collar by its 8-digit code: no secret, deviceId derived, code in the DTO; 409 for a second claim', async () => {
    const prisma = makePrisma();
    const svc = new DevicesService(prisma as any);
    const res: any = await svc.registerDevice('u', 'f', { code: '12345678' } as any);
    expect(res).not.toHaveProperty('deviceSecret');
    expect(res.collar).toMatchObject({ deviceId: 'QAM-12345678', code: '12345678' });
    expect(prisma.rows[0]).toMatchObject({ code: '12345678', farmId: 'f' });
    await expect(svc.registerDevice('u', 'other-farm', { code: '12345678' } as any)).rejects.toThrow(ConflictException);
    // listing shows the code, never a secret
    const list = await svc.listDevices('u', 'f');
    expect(list[0].code).toBe('12345678');
    expect(JSON.stringify(list)).not.toMatch(/secret|hash/i);
  });

  it('registration needs a code or a deviceId', async () => {
    const svc = new DevicesService(makePrisma() as any);
    await expect(svc.registerDevice('u', 'f', {} as any)).rejects.toThrow(BadRequestException);
  });

  it('409 when the id already exists, whichever farm owns it', async () => {
    const prisma = makePrisma();
    const svc = new DevicesService(prisma as any);
    await svc.registerDevice('u', 'f', { deviceId: 'QAM-0001' } as any);
    await expect(svc.registerDevice('u', 'other-farm', { deviceId: 'QAM-0001' } as any)).rejects.toThrow(ConflictException);
  });

  it('test signal: queues a command for own device, 404 for foreign device', async () => {
    const prisma = makePrisma();
    const svc = new DevicesService(prisma as any);
    await svc.registerDevice('u', 'f', { deviceId: 'QAM-0001' } as any);
    await expect(svc.queueTestSignal('u', 'f', 'QAM-0001', { signal: 'SOUND' })).resolves.toEqual({ commandId: 'cmd-1' });
    expect(prisma.deviceCommand.create.mock.calls[0][0].data.command).toBe('TEST_SOUND');
    await expect(svc.queueTestSignal('u', 'other', 'QAM-0001', { signal: 'SOUND' })).rejects.toThrow(NotFoundException);
  });

  it('IMPULSE is rejected by the DTO', async () => {
    const bad = await validate(plainToInstance(TestSignalDto, { signal: 'IMPULSE' }));
    expect(bad.length).toBe(1);
    const ok = await validate(plainToInstance(TestSignalDto, { signal: 'VIBRATION' }));
    expect(ok.length).toBe(0);
  });

  it('toCollarDto: unassigned / offline / online', () => {
    expect(toCollarDto({ deviceId: 'a', animal: null }).status).toBe('UNASSIGNED');
    expect(toCollarDto({ deviceId: 'a', animal: { id: 'x', name: 'n' }, lastHeartbeatAt: null }).status).toBe('OFFLINE');
    expect(toCollarDto({ deviceId: 'a', animal: { id: 'x', name: 'n' }, lastHeartbeatAt: new Date() }).status).toBe('ONLINE');
  });
});
