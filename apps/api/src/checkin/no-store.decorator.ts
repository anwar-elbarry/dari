import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';

/**
 * Responses that carry a token, personal data or a document are never cached and never indexed, and the page
 * that displays them sends no referrer. Headers are set before the handler runs, so error responses carry them too.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return next.handle();
  }
}

export const NoStore = () => UseInterceptors(NoStoreInterceptor);
