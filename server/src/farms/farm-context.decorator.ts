import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Farm id resolved and verified by FarmAccessGuard. */
export const FarmId = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().farmId;
});

/** Role of the user in the resolved farm. */
export const MemberRole = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().memberRole;
});
