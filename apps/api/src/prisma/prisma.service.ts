import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { accountScopeExtension } from './account-scope';

/**
 * Single Prisma client for the app. Connects lazily on first query, so the app (and tests
 * that never touch the database) can boot without Postgres.
 * Tenant data must be read through `forAccount(accountId)`, never through this client directly
 * (exceptions: auth flows that look a user up by email or token before an account is known).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /** Client that can only see and write rows of one account. */
  forAccount(accountId: string) {
    return this.$extends(accountScopeExtension(accountId));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

export type ScopedPrisma = ReturnType<PrismaService['forAccount']>;
