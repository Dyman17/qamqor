import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashDeviceSecret, verifyDeviceSecret } from './device-secret';

export const DEVICE_AUTH_ERROR = 'Invalid device credentials';

/**
 * Authenticates a collar by its per-device secret (`Authorization: Bearer <secret>`).
 * The secret is high-entropy, so the stored SHA-256 hash is used as the lookup key;
 * the comparison is repeated in constant time. Every failure yields the same 401.
 * The authenticated device is attached as `request.device`.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const token = header && header.startsWith('Bearer ') ? header.substring(7).trim() : undefined;
    if (!token) throw new UnauthorizedException(DEVICE_AUTH_ERROR);

    const device = await this.prisma.device.findUnique({
      where: { secretHash: hashDeviceSecret(token) },
      include: { farm: true, animal: { include: { activeGeofence: true } } },
    });
    if (!device || !verifyDeviceSecret(token, device.secretHash)) {
      throw new UnauthorizedException(DEVICE_AUTH_ERROR);
    }

    // If the request names a device, it must be the one that owns the secret.
    const claimed: string | undefined = req.body?.deviceId ?? req.query?.deviceId;
    if (claimed !== undefined && claimed !== device.deviceId) {
      throw new UnauthorizedException(DEVICE_AUTH_ERROR);
    }

    req.device = device;
    return true;
  }
}
