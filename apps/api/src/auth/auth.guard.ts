import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { AppRequest } from './auth.types';
import { cookieScheme } from './cookies';
import { IS_PUBLIC } from './decorators';

export interface AccessPayload {
  sub: string;
  acc: string;
  /** Issued-at, seconds (added by the JWT library). */
  iat?: number;
}

const unauthorized = () => new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Authentication required.' });

/**
 * Global guard: every route needs a valid session unless marked @Public().
 * The user is re-read from the DB on each request so a disabled user or a role change applies immediately,
 * not after the access token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const token: unknown = req.cookies?.[cookieScheme(this.config).access.name];
    if (typeof token !== 'string' || !token) throw unauthorized();

    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, accountId: true, role: true, disabledAt: true, sessionsRevokedAt: true },
    });
    if (!user || user.disabledAt || user.accountId !== payload.acc) throw unauthorized();
    // Password reset, reuse detection and logout cut off access tokens issued before them (whole seconds: `iat` has no fraction).
    if (user.sessionsRevokedAt && (typeof payload.iat !== 'number' || payload.iat < Math.floor(user.sessionsRevokedAt.getTime() / 1000))) throw unauthorized();

    req.user = { id: user.id, accountId: user.accountId, role: user.role };
    return true;
  }
}

