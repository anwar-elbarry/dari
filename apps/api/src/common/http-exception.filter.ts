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

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId: string | undefined = res.locals?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody['error'] = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const payload = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};
      body = {
        code: typeof payload.code === 'string' ? payload.code : (HttpStatus[status] ?? 'ERROR'),
        message: typeof payload.message === 'string' ? payload.message : exception.message,
        ...(payload.details !== undefined ? { details: payload.details } : {}),
      };
    } else {
      this.logger.error(`[${requestId ?? '-'}] ${exception instanceof Error ? exception.stack : String(exception)}`);
    }

    res.status(status).json({ error: body, requestId } satisfies ErrorBody);
  }
}
