import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client for the app. Connects lazily on first query, so the app (and tests
 * that never touch the database) can boot without Postgres.
 * Tenant tables must be read through account-scoped helpers (Phase 1, step 1.3), not directly.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
