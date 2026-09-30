import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'dari';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const SKIP_CSRF = 'skipCsrf';

/**
 * For a server-to-server route that has no browser session to defend and proves who is calling in another way
 * (a signature over the body: the WhatsApp delivery webhook). Only ever on a @Public() route that checks that proof
 * before doing anything; a browser cannot forge it, so the CSRF header would add nothing.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/**
 * CSRF defence for cookie sessions: every state-changing request must carry a custom header.
 * Browsers cannot add it cross-site without a CORS preflight, and the API enables no CORS.
 * Applies to public routes too (login CSRF). SameSite=Lax cookies are the second layer.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()])) return true;
    if (req.header(CSRF_HEADER) === CSRF_HEADER_VALUE) return true;
    throw new ForbiddenException({ code: 'CSRF_HEADER_MISSING', message: 'Missing request header.' });
  }
}
