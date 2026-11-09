import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateDeviceSecret, hashDeviceSecret } from './device-secret';

export const DEVICE_AUTH_ERROR = 'Invalid device credentials';
export const DEVICE_CODE_PATTERN = /^[0-9]{8}$/;
export const DEVICE_CODE_HEADER = 'x-device-code';

/** Max never-claimed devices stored at once (open acceptance, owner decision 2026-11-09). */
export const UNCLAIMED_DEVICES_MAX = 500;

/** The 8-digit code of a telemetry request (body first, then the X-Device-Code header), or null. */
export function requestDeviceCode(req: any): string | null {
  const raw = req?.body?.code ?? req?.headers?.[DEVICE_CODE_HEADER];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && DEVICE_CODE_PATTERN.test(v) ? v : null;
}

/**
 * Identifies a collar by its 8-digit device code (owner decision 2026-11-09, see
 * docs/architecture/device-code-protocol.md). The code is an identity, not a secret.
 * Open acceptance (prototype): ANY well-formed code is accepted. The first ping from an unknown code
 * creates an unclaimed device (no farm, no animal), capped at UNCLAIMED_DEVICES_MAX; the owner can
 * claim it later with POST /devices {code}. A malformed code or a body/header disagreement is a 400.
 * The device is attached as `request.device`.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const code = requestDeviceCode(req);
    if (!code) throw new BadRequestException('code: exactly 8 digits are required');

    // A body code that disagrees with the header is a malformed request, not a lookup.
    const header = req.headers?.[DEVICE_CODE_HEADER];
    if (typeof header === 'string' && req.body?.code !== undefined && header !== req.body.code) {
      throw new BadRequestException('code: body and X-Device-Code header disagree');
    }

    const include = { farm: true, animal: { include: { activeGeofence: true } } };
    let device = await this.prisma.device.findUnique({ where: { code }, include });
    if (!device) {
      const unclaimed = await this.prisma.device.count({ where: { farmId: null, isSimulated: false } });
      if (unclaimed >= UNCLAIMED_DEVICES_MAX) {
        throw new HttpException(
          { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many unclaimed devices', retryAfterSec: 3600 },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      try {
        device = await this.prisma.device.create({
          data: {
            deviceId: `QAM-${code}`,
            code,
            secretHash: hashDeviceSecret(generateDeviceSecret()), // never used; the code is the identity
            isSimulated: false,
          },
          include,
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        // A parallel first ping created it (or a legacy id collides with QAM-<code>).
        device = await this.prisma.device.findUnique({ where: { code }, include });
        if (!device) throw new UnauthorizedException(DEVICE_AUTH_ERROR);
      }
    }

    req.device = device;
    return true;
  }
}
