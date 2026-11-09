import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { DeviceAuthGuard, requestDeviceCode } from '../src/devices/device-auth.guard';
import { toErrorBody } from '../src/common/api-exception.filter';

const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;
const claimed = { id: '1', deviceId: 'QAM-12345678', code: '12345678', farmId: 'f1' };
const unclaimed = { id: '2', deviceId: 'QAM-LEGACY', code: '87654321', farmId: null };

function guard(count = 0) {
  const prisma: any = {
    device: {
      findUnique: jest.fn(async ({ where }: any) => [claimed, unclaimed].find((d) => d.code === where.code) ?? null),
      count: jest.fn(async () => count),
      create: jest.fn(async ({ data }: any) => ({ id: 'new', farmId: null, farm: null, animal: null, ...data })),
    },
  };
  return { prisma, guard: new DeviceAuthGuard(prisma) };
}

describe('DeviceAuthGuard (8-digit code, open acceptance)', () => {
  it('attaches a claimed device, code from the body or the header', async () => {
    const { guard: g, prisma } = guard();
    const a: any = { headers: {}, body: { code: '12345678' } };
    await expect(g.canActivate(ctx(a))).resolves.toBe(true);
    expect(a.device).toBe(claimed);
    const b: any = { headers: { 'x-device-code': '12345678' }, body: {} };
    await expect(g.canActivate(ctx(b))).resolves.toBe(true);
    expect(b.device).toBe(claimed);
    expect(prisma.device.create).not.toHaveBeenCalled();
  });

  it('an existing unclaimed device is attached as is', async () => {
    const { guard: g, prisma } = guard();
    const r: any = { headers: {}, body: { code: '87654321' } };
    await g.canActivate(ctx(r));
    expect(r.device).toBe(unclaimed);
    expect(prisma.device.create).not.toHaveBeenCalled();
  });

  it('an unknown well-formed code creates an unclaimed device (no farm, not simulated)', async () => {
    const { guard: g, prisma } = guard();
    const r: any = { headers: {}, body: { code: '00000000' } };
    await expect(g.canActivate(ctx(r))).resolves.toBe(true);
    const data = prisma.device.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ code: '00000000', deviceId: 'QAM-00000000', isSimulated: false });
    expect(data).not.toHaveProperty('farmId');
    expect(data.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.device.farmId).toBeNull();
  });

  it('refuses with 429 beyond the cap and creates nothing', async () => {
    const { guard: g, prisma } = guard(500);
    const err: any = await g.canActivate(ctx({ headers: {}, body: { code: '00000000' } })).catch((e) => e);
    expect(err.getStatus()).toBe(429);
    expect(toErrorBody(err).body).toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 3600 });
    expect(prisma.device.create).not.toHaveBeenCalled();
  });

  it('malformed, missing or disagreeing code: 400, nothing is created', async () => {
    const { guard: g, prisma } = guard();
    const bad = [
      { headers: {}, body: { code: '1234567' } },
      { headers: {}, body: { code: 12345678 } },
      { headers: {}, body: {} },
      { headers: { 'x-device-code': '12345678' }, body: { code: '87654321' } },
    ];
    for (const req of bad) await expect(g.canActivate(ctx(req))).rejects.toThrow(BadRequestException);
    expect(prisma.device.create).not.toHaveBeenCalled();
  });

  it('requestDeviceCode only returns well-formed codes', () => {
    expect(requestDeviceCode({ body: { code: '12345678' } })).toBe('12345678');
    expect(requestDeviceCode({ body: {}, headers: { 'x-device-code': '00000001' } })).toBe('00000001');
    expect(requestDeviceCode({ body: { code: '12 45678' } })).toBeNull();
    expect(requestDeviceCode({})).toBeNull();
  });

  it('the error kind stays available for the telemetry error body', () => {
    expect(toErrorBody(new UnauthorizedException('x')).body.code).toBe('UNAUTHENTICATED');
  });
});
