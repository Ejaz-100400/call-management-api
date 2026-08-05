import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';

/**
 * Returns the `users` table row for the logged-in person (populated by
 * RolesGuard, which looks it up from the verified Supabase JWT's `sub` claim).
 * Use as: updateExtraction(@CurrentUser() user: User) { ... user.id, user.role }
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const request = ctx.switchToHttp().getRequest();
  return request.appUser;
});
