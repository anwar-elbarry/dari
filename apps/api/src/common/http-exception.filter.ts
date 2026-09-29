import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

/** Validation failures carry this code so the web app can map `details` to form fields. */
export const VALIDATION_FAILED = 'VALIDATION_FAILED';

/**
 * One error shape for every response:
 *   { error: { code, message, details? }, requestId }
 * Unexpected errors return a generic 500; the real error is logged server-side with the request id,
 * never sent to the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  /**
   * @param includeMessage development only. An unexpected error's message can quote data (a Prisma
   * error prints the values of a failed write), so in production only the error type, its code and the
   * stack frames are logged.
   */
  constructor(private readonly includeMessage = false) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId: string | undefined = res.locals?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody['error'] = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
    const clientStatus = clientErrorStatus(exception);

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const payload = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};
      // Only our own errors (thrown with an explicit code) carry their message. Framework messages can
      // quote the request (e.g. JSON parse errors), so they are replaced by a fixed text per status.
      const own = typeof payload.code === 'string' && typeof payload.message === 'string';
      body = {
        code: own ? (payload.code as string) : (HttpStatus[status] ?? 'ERROR'),
        message: own ? (payload.message as string) : fixedMessage(status),
        ...(own && payload.details !== undefined ? { details: payload.details } : {}),
      };
    } else if (clientStatus) {
      // body-parser errors (too large, bad JSON, bad charset) are client errors, not crashes.
      status = clientStatus;
      body = { code: HttpStatus[status] ?? 'BAD_REQUEST', message: fixedMessage(status) };
    } else {
      this.logger.error(`[${requestId ?? '-'}] ${describeUnexpected(exception, this.includeMessage)}`);
    }

    res.status(status).json({ error: body, requestId } satisfies ErrorBody);
  }
}

/** Error type, code and stack frames; the message only when asked (see the constructor). */
export function describeUnexpected(e: unknown, includeMessage: boolean): string {
  if (!(e instanceof Error)) return 'non-error value thrown';
  const code = (e as { code?: unknown }).code;
  const head = `${e.name}${typeof code === 'string' ? ` (${code})` : ''}`;
  const frames = (e.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l));
  return [includeMessage ? `${head}: ${e.message}` : head, ...frames].join('\n');
}

const FIXED_MESSAGES: Partial<Record<number, string>> = {
  400: 'Bad request.',
  401: 'Authentication required.',
  403: 'Forbidden.',
  404: 'Not found.',
  413: 'Request body too large.',
  415: 'Unsupported content type.',
  429: 'Too many requests. Try again later.',
};

function fixedMessage(status: number): string {
  return FIXED_MESSAGES[status] ?? (status >= 500 ? 'An unexpected error occurred.' : 'Request failed.');
}

function clientErrorStatus(e: unknown): number | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const s = (e as { status?: unknown; statusCode?: unknown }).status ?? (e as { statusCode?: unknown }).statusCode;
  return typeof s === 'number' && s >= 400 && s < 500 ? s : undefined;
}
