import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves the farm of the request and verifies membership in one place.
 * Reads `x-farm-id`; when absent and the user belongs to exactly one farm, that farm is used,
 * otherwise 400. Puts `farmId` and `memberRole` on the request. Must run after JwtAuthGuard.
 */
@Injectable()
export class FarmAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.id) throw new ForbiddenException('Нет доступа к этому хозяйству');

    const raw = req.headers?.['x-farm-id'];
    const header = Array.isArray(raw) ? raw[0] : raw;

    if (header) {
      const m = await this.prisma.farmMember.findUnique({
        where: { userId_farmId: { userId: user.id, farmId: String(header) } },
      });
      if (!m) throw new ForbiddenException('Нет доступа к этому хозяйству');
      req.farmId = m.farmId;
      req.memberRole = m.role;
      return true;
    }

    const memberships = await this.prisma.farmMember.findMany({ where: { userId: user.id }, take: 2 });
    if (memberships.length === 0) throw new ForbiddenException('Нет доступа к этому хозяйству');
    if (memberships.length > 1) throw new BadRequestException('Укажите хозяйство в заголовке x-farm-id');
    req.farmId = memberships[0].farmId;
    req.memberRole = memberships[0].role;
    return true;
  }
}
