import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AppRequest, AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';

/** Route reachable without a session (login, signup, public token pages). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The authenticated user. Only valid on non-public routes. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without an authenticated user');
  return user;
});
