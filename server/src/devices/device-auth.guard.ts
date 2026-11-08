import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const DEVICE_AUTH_ERROR = 'Invalid device credentials';
export const DEVICE_CODE_PATTERN = /^[0-9]{8}$/;
export const DEVICE_CODE_HEADER = 'x-device-code';

/** The 8-digit code of a telemetry request (body first, then the X-Device-Code header), or null. */
export function requestDeviceCode(req: any): string | null {
  const raw = req?.body?.code ?? req?.headers?.[DEVICE_CODE_HEADER];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && DEVICE_CODE_PATTERN.test(v) ? v : null;
}

/**
 * Identifies a collar by its 8-digit device code (owner decision 2026-11-09, see
 * docs/architecture/device-code-protocol.md). The code is an identity, not a secret: an unknown or
 * never-claimed code is rejected with the same 401 as a malformed one and nothing is stored.
 * The authenticated device is attached as `request.device`.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const code = requestDeviceCode(req);
    if (!code) throw new UnauthorizedException(DEVICE_AUTH_ERROR);

    // A body code that disagrees with the header is a malformed request, not a lookup.
    const header = req.headers?.[DEVICE_CODE_HEADER];
    if (typeof header === 'string' && req.body?.code !== undefined && header !== req.body.code) {
      throw new UnauthorizedException(DEVICE_AUTH_ERROR);
    }

    const device = await this.prisma.device.findUnique({
      where: { code },
      include: { farm: true, animal: { include: { activeGeofence: true } } },
    });
    if (!device || !device.farmId) throw new UnauthorizedException(DEVICE_AUTH_ERROR);

    req.device = device;
    return true;
  }
}
