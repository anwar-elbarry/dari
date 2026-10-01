import { parseArgs } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import { isEmail } from 'class-validator';
import { hashPassword } from '../auth/auth.service';
import { randomToken } from '../auth/tokens';
import { isUniqueViolation } from '../common/prisma-errors';

export interface NewAccount {
  companyName: string;
  ownerName: string;
  email: string;
  seatLimit: number;
}

export type ParsedAccountArgs = { ok: true; account: NewAccount } | { ok: false; problems: string[] };

const MAX_SEATS = 1000;

/** Same rules as `SignupDto`: trimmed names of 2 to 120 characters, a lower-cased e-mail of at most 254. */
export function parseAccountArgs(argv: string[]): ParsedAccountArgs {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { company: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, seats: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return { ok: false, problems: ['unknown option or missing value (expected --company, --name, --email, optional --seats)'] };
  }
  const problems: string[] = [];
  const companyName = (values.company ?? '').trim();
  const ownerName = (values.name ?? '').trim();
  const email = (values.email ?? '').trim().toLowerCase();
  if (companyName.length < 2 || companyName.length > 120) problems.push('--company must be 2 to 120 characters');
  if (ownerName.length < 2 || ownerName.length > 120) problems.push('--name must be 2 to 120 characters');
  if (email.length > 254 || !isEmail(email)) problems.push('--email must be a valid e-mail address');
  let seatLimit = 1;
  if (values.seats !== undefined) {
    seatLimit = /^\d+$/.test(values.seats) ? Number(values.seats) : NaN;
    if (!Number.isInteger(seatLimit) || seatLimit < 1 || seatLimit > MAX_SEATS) problems.push(`--seats must be a whole number from 1 to ${MAX_SEATS}`);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, account: { companyName, ownerName, email, seatLimit } };
}

export type CreateAccountResult = { ok: true; accountId: string; userId: string } | { ok: false; code: 'EMAIL_IN_USE' };

/**
 * Creates an account and its first Owner/Manager, the way signup does, for pilots while signup is closed.
 * The owner gets a random password nobody knows and chooses theirs with "Forgot password", so no password
 * or link passes through the operator's terminal. Audited as `account.signup` with no actor.
 */
export async function createAccount(prisma: PrismaClient, input: NewAccount): Promise<CreateAccountResult> {
  const passwordHash = await hashPassword(randomToken());
  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({ data: { companyName: input.companyName, seatLimit: input.seatLimit } });
      const user = await tx.user.create({
        data: { accountId: account.id, name: input.ownerName, email: input.email, role: 'OWNER_MANAGER', passwordHash },
      });
      await tx.auditLog.create({ data: { accountId: account.id, actorId: null, action: 'account.signup', resourceType: 'Account', resourceId: account.id, ip: null } });
      return { ok: true as const, accountId: account.id, userId: user.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, code: 'EMAIL_IN_USE' };
    throw e;
  }
}
