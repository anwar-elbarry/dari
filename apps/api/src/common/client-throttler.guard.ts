import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { throttleKey } from './throttle-key';

/** The global rate limiter, keyed on the client address with IPv6 collapsed to its /64 (see `throttleKey`). */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return throttleKey(req.ip as string | undefined);
  }
}
