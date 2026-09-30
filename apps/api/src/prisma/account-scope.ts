import { Prisma } from '@prisma/client';

/** Models that carry `accountId` directly. Other models are refused by the scoped client until a rule is added. */
export const TENANT_MODELS = new Set<string>([
  'User',
  'PropertyOwner',
  'Property',
  'Booking',
  'IcalFeed',
  'ImportBatch',
  'Invitation',
  'AuditLog',
  'ShareLink',
  'Notification',
  'Vendor',
  'StoredObject',
  'CheckInLink',
  'GuestCheckIn',
  'FicheDePolice',
  'PoliceRegister',
  'ShareAccess',
  'TaxReport',
]);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown };

export class AccountScopeError extends Error {}

function assertNoOtherAccount(value: unknown, accountId: string, where: string) {
  if (value && typeof value === 'object' && 'accountId' in value) {
    const v = (value as { accountId: unknown }).accountId;
    if (v !== undefined && v !== accountId) throw new AccountScopeError(`${where}: accountId mismatch`);
  }
}

/**
 * Rewrites a query so it can only touch rows of `accountId`:
 * - reads, updates and deletes get `accountId` added to `where`;
 * - creates get `accountId` set (pass it explicitly for Prisma's types; a different value is an error);
 * - an update can never change `accountId`.
 * Foreign keys to other tenant rows (e.g. Property.ownerId) are NOT checked here: services must
 * load the referenced row through the scoped client first.
 */
const NESTED_WRITE_KEYS = ['connect', 'connectOrCreate', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'set', 'disconnect', 'delete', 'deleteMany'];

/** Nested writes could reach rows of another account; tenant writes must use plain foreign-key columns. */
function assertNoNestedWrites(data: unknown, where: string) {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const [key, value] of Object.entries(row)) {
      if (value && typeof value === 'object' && !(value instanceof Date) && NESTED_WRITE_KEYS.some((k) => k in value)) {
        throw new AccountScopeError(`${where}: nested write on "${key}" is not allowed; set the foreign key and check it through forAccount()`);
      }
    }
  }
}

export function scopeArgs(model: string, operation: string, args: Args, accountId: string): Args {
  if (!TENANT_MODELS.has(model)) {
    throw new AccountScopeError(`Model ${model} has no account scope rule; add one before using it through forAccount().`);
  }
  const next: Args = { ...args };
  for (const k of ['data', 'create', 'update'] as const) {
    if (next[k] !== undefined) assertNoNestedWrites(next[k], `${model}.${operation} ${k}`);
  }

  if (WHERE_OPS.has(operation)) {
    assertNoOtherAccount(next.where, accountId, `${model}.${operation} where`);
    next.where = { ...(next.where ?? {}), accountId };
  }

  if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
    if (next.data && typeof next.data === 'object' && 'accountId' in next.data) {
      throw new AccountScopeError(`${model}.${operation}: accountId cannot be changed`);
    }
  }

  if (operation === 'create') {
    assertNoOtherAccount(next.data, accountId, `${model}.create data`);
    next.data = { ...(next.data as object), accountId };
  }

  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const rows = Array.isArray(next.data) ? next.data : [next.data];
    next.data = rows.map((row) => {
      assertNoOtherAccount(row, accountId, `${model}.${operation} data`);
      return { ...(row as object), accountId };
    });
  }

  if (operation === 'upsert') {
    assertNoOtherAccount(next.where, accountId, `${model}.upsert where`);
    next.where = { ...(next.where ?? {}), accountId };
    const create = next.create as object;
    assertNoOtherAccount(create, accountId, `${model}.upsert create`);
    next.create = { ...create, accountId };
    if (next.update && typeof next.update === 'object' && 'accountId' in next.update) {
      throw new AccountScopeError(`${model}.upsert: accountId cannot be changed`);
    }
  }

  return next;
}

export function accountScopeExtension(accountId: string) {
  return Prisma.defineExtension({
    name: 'account-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Args, accountId) as typeof args);
        },
      },
    },
  });
}
