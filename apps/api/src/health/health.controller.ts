import { Controller, Get, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { REDIS, RedisClient, redisDown } from '../redis/redis.module';

/**
 * 200 `ok`, or 503 `degraded` while Redis is configured and down (every rate limit, the login lockout and the view
 * counters fail closed then, so the instance cannot serve). Not rate limited: the limiter itself needs Redis.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  @Public()
  @SkipThrottle()
  @Get()
  check(@Res({ passthrough: true }) res: Response) {
    if (redisDown(this.redis)) {
      res.status(503);
      return { status: 'degraded' };
    }
    return { status: 'ok' };
  }
}
