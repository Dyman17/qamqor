import { ForbiddenException } from '@nestjs/common';

/** 403 for an action the member's role (or the farm switch) does not allow. */
export const forbiddenRole = (message: string) =>
  new ForbiddenException({ statusCode: 403, code: 'FORBIDDEN_ROLE', message });

/** 403 for a farm the user is not a member of. */
export const forbiddenFarm = (message = 'Нет доступа к этому хозяйству') =>
  new ForbiddenException({ statusCode: 403, code: 'FORBIDDEN_FARM', message });
