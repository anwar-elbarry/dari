import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'dari';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions: every state-changing request must carry a custom header.
 * Browsers cannot add it cross-site without a CORS preflight, and the API enables no CORS.
 * Applies to public routes too (login CSRF). SameSite=Lax cookies are the second layer.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.header(CSRF_HEADER) === CSRF_HEADER_VALUE) return true;
    throw new ForbiddenException({ code: 'CSRF_HEADER_MISSING', message: 'Missing request header.' });
  }
}
