import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { forbiddenFarm } from '../common/errors';

/**
 * Resolves the farm of the request and verifies membership in one place.
 * Reads `x-farm-id`; when absent and the user belongs to exactly one farm, that farm is used,
 * otherwise 400. Puts `farmId`, `memberRole` and `canEditBoundaries` on the request.
 * Must run after JwtAuthGuard. Role checks are done by PermissionsGuard.
 */
@Injectable()
export class FarmAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  private attach(req: any, m: any) {
    req.farmId = m.farmId;
    req.memberRole = m.role;
    req.canEditBoundaries = m.role === 'OWNER' || m.farm?.workerCanEditBoundaries === true;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.id) throw forbiddenFarm();

    const raw = req.headers?.['x-farm-id'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const include = { farm: { select: { workerCanEditBoundaries: true } } };

    if (header) {
      const m = await this.prisma.farmMember.findUnique({
        where: { userId_farmId: { userId: user.id, farmId: String(header) } },
        include,
      });
      if (!m) throw forbiddenFarm();
      this.attach(req, m);
      return true;
    }

    const memberships = await this.prisma.farmMember.findMany({ where: { userId: user.id }, take: 2, include });
    if (memberships.length === 0) throw forbiddenFarm();
    if (memberships.length > 1) throw new BadRequestException('Укажите хозяйство в заголовке x-farm-id');
    this.attach(req, memberships[0]);
    return true;
  }
}
