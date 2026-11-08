import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BOUNDARY_EDIT_KEY, FARM_ROLES_KEY, FarmRoleName } from './roles.decorator';
import { forbiddenRole } from '../common/errors';

/**
 * Enforces `@FarmRoles()` / `@RequireBoundaryEdit()`. Runs after FarmAccessGuard,
 * which puts `memberRole` and `canEditBoundaries` on the request.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<FarmRoleName[] | undefined>(FARM_ROLES_KEY, targets);
    const needsBoundary = this.reflector.getAllAndOverride<boolean | undefined>(BOUNDARY_EDIT_KEY, targets);
    if (!roles && !needsBoundary) return true;

    const req = context.switchToHttp().getRequest();
    if (roles && !roles.includes(req.memberRole)) {
      throw forbiddenRole('Недостаточно прав: действие доступно только владельцу хозяйства');
    }
    if (needsBoundary && !req.canEditBoundaries) {
      throw forbiddenRole('Изменение границ и перегон доступны владельцу или при включённом праве работника');
    }
    return true;
  }
}
