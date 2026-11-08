import { UnauthorizedException } from '@nestjs/common';
import { DeviceSecretAuthGuard as DeviceAuthGuard } from '../src/devices/device-secret-auth.guard';
import { generateDeviceSecret, hashDeviceSecret } from '../src/devices/device-secret';

function ctx(req: any) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

describe('DeviceSecretAuthGuard (legacy, camera only)', () => {
  const secret = generateDeviceSecret();
  const device = { id: '1', deviceId: 'QAM-0001', secretHash: hashDeviceSecret(secret) };
  const prisma: any = {
    device: {
      findUnique: jest.fn(async ({ where }: any) => (where.secretHash === device.secretHash ? device : null)),
      create: jest.fn(),
    },
  };
  const guard = new DeviceAuthGuard(prisma);

  const expect401 = async (req: any) => {
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(UnauthorizedException);
    await guard.canActivate(ctx(req)).catch((e) => expect(e.message).toBe('Invalid device credentials'));
  };

  it('401 without token', async () => {
    await expect401({ headers: {}, body: { deviceId: 'QAM-0001' } });
  });
  it('401 with wrong token', async () => {
    await expect401({ headers: { authorization: 'Bearer ' + generateDeviceSecret() }, body: {} });
  });
  it('401 with another collar token / unknown deviceId, same message, no creation', async () => {
    await expect401({ headers: { authorization: 'Bearer ' + secret }, body: { deviceId: 'QAM-9999' } });
    expect(prisma.device.create).not.toHaveBeenCalled();
  });
  it('accepts the right secret and attaches the device', async () => {
    const req: any = { headers: { authorization: 'Bearer ' + secret }, body: { deviceId: 'QAM-0001' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.device).toBe(device);
  });
  it('rejects the retired shared key', async () => {
    await expect401({ headers: { authorization: 'Bearer retired_shared_key' }, body: { deviceId: 'QAM-0001' } });
  });
});
