import { UnauthorizedException } from '@nestjs/common';
import { DeviceAuthGuard, requestDeviceCode } from '../src/devices/device-auth.guard';
import { toErrorBody } from '../src/common/api-exception.filter';

const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;
const claimed = { id: '1', deviceId: 'QAM-12345678', code: '12345678', farmId: 'f1' };
const unclaimed = { id: '2', deviceId: 'QAM-LEGACY', code: '87654321', farmId: null };

function guard() {
  const prisma: any = {
    device: {
      findUnique: jest.fn(async ({ where }: any) => [claimed, unclaimed].find((d) => d.code === where.code) ?? null),
      create: jest.fn(),
    },
  };
  return { prisma, guard: new DeviceAuthGuard(prisma) };
}

describe('DeviceAuthGuard (8-digit code)', () => {
  it('attaches a claimed device, code from the body or the header', async () => {
    const { guard: g } = guard();
    const a: any = { headers: {}, body: { code: '12345678' } };
    await expect(g.canActivate(ctx(a))).resolves.toBe(true);
    expect(a.device).toBe(claimed);
    const b: any = { headers: { 'x-device-code': '12345678' }, body: {} };
    await expect(g.canActivate(ctx(b))).resolves.toBe(true);
    expect(b.device).toBe(claimed);
  });

  it('unknown, unclaimed, malformed or missing code: the same 401, nothing is created', async () => {
    const { guard: g, prisma } = guard();
    const bad = [
      { headers: {}, body: { code: '00000000' } },
      { headers: {}, body: { code: '87654321' } }, // exists but no farm
      { headers: {}, body: { code: '1234567' } },
      { headers: {}, body: { code: 12345678 } }, // a number, not a string
      { headers: {}, body: {} },
      { headers: { 'x-device-code': '12345678' }, body: { code: '87654321' } }, // disagreement
    ];
    for (const req of bad) {
      await expect(g.canActivate(ctx(req))).rejects.toThrow(UnauthorizedException);
      await g.canActivate(ctx(req)).catch((e) => expect(e.message).toBe('Invalid device credentials'));
    }
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
