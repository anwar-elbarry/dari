import { Logger } from '@nestjs/common';

const RETRY_MS = 30_000;

/**
 * Registers a recurring job without holding up start-up. Awaiting it in `onModuleInit` kept the API from listening at
 * all while Redis was down (Phase 7.4 drill): no health answer, no log. Here the API starts (health says `degraded`),
 * every failed attempt is logged, and it is retried until it succeeds, because the retention purge must not silently
 * stop being scheduled. Returns the first attempt, for tests.
 */
export function scheduleInBackground(name: string, register: () => Promise<unknown>, retryMs = RETRY_MS): Promise<void> {
  const logger = new Logger('Jobs');
  const attempt = async (): Promise<void> => {
    try {
      await register();
    } catch (e) {
      logger.error(`could not schedule "${name}" (${e instanceof Error ? e.name : 'error'}); retrying in ${retryMs / 1000} s`);
      setTimeout(() => void attempt(), retryMs).unref();
    }
  };
  return attempt();
}

/**
 * BullMQ prints connection errors with `console.error` when nothing listens: the whole error, Redis host and port
 * included, outside the redacting logger. Each queue and worker reports here instead, by error type only.
 */
export function logJobError(queue: string, e: unknown): void {
  new Logger('Jobs').error(`queue "${queue}" error (${e instanceof Error ? e.name : 'error'})`);
}
