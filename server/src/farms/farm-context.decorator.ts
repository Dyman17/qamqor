import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Farm id resolved and verified by FarmAccessGuard. */
export const FarmId = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().farmId;
});

/** Role of the user in the resolved farm ('OWNER' | 'WORKER'). */
export const MemberRole = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().memberRole;
});

/** True for the owner, or for a worker when the owner enabled `workerCanEditBoundaries`. */
export const CanEditBoundaries = createParamDecorator((_d: unknown, ctx: ExecutionContext): boolean => {
  return ctx.switchToHttp().getRequest().canEditBoundaries === true;
});
