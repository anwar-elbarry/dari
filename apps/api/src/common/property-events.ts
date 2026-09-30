import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { describeUnexpected } from './http-exception.filter';

type Handler = (accountId: string, propertyId: string) => Promise<unknown>;

/**
 * Tiny in-process notifier: "the nights of this property may have changed" (sync, import, reclassification).
 * Listeners (alerts) register at startup. A failing listener is logged and never fails the caller.
 */
@Injectable()
export class PropertyEvents {
  private readonly logger = new Logger('PropertyEvents');
  private readonly handlers: Handler[] = [];

  onNightsChanged(handler: Handler) {
    this.handlers.push(handler);
  }

  async nightsChanged(accountId: string, propertyId: string): Promise<void> {
    for (const h of this.handlers) {
      try {
        await h(accountId, propertyId);
      } catch (e) {
        this.logger.error(`listener failed: ${describeUnexpected(e, false)}`);
      }
    }
  }
}

@Global()
@Module({ providers: [PropertyEvents], exports: [PropertyEvents] })
export class PropertyEventsModule {}
