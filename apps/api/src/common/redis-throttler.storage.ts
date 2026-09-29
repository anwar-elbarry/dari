import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';

/**
 * Rate-limit counters shared across API instances. One atomic script per hit:
 * increment the window counter (set its TTL on first hit), and when the limit is passed,
 * start a block key for `blockDuration`. Mirrors the library's in-memory storage.
 */
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if hits > tonumber(ARGV[2]) and blockTtl < 0 then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blockTtl = tonumber(ARGV[3])
end
return { hits, ttl, blockTtl }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'throttle',
  ) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}:${throttlerName}:${key}`;
    const [hits, ttlLeft, blockLeft] = (await this.redis.eval(SCRIPT, 2, base, `${base}:block`, ttl, limit, blockDuration || ttl)) as [number, number, number];
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttlLeft / 1000)),
      isBlocked: blockLeft > 0,
      timeToBlockExpire: Math.max(0, Math.ceil(blockLeft / 1000)),
    };
  }
}
