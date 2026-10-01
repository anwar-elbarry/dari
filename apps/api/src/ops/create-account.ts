/*
 * Creates a pilot account and its Owner/Manager while signup is closed (SIGNUP_ENABLED off):
 *   npm run account:create -w apps/api -- --company "Riad Example" --name "Owner Name" --email owner@example.ma [--seats 3]
 * No password is set or printed: tell the owner to open the login page and use "Forgot password" with this e-mail.
 * Prints ids only.
 */
import { PrismaClient } from '@prisma/client';
import { createAccount, parseAccountArgs } from './account-create';

async function main() {
  const parsed = parseAccountArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`usage: create-account --company <name> --name <owner name> --email <e-mail> [--seats <n>]\n${parsed.problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const r = await createAccount(prisma, parsed.account);
    if (!r.ok) {
      console.error('an account already uses this e-mail; nothing was created');
      process.exit(1);
    }
    console.log(`Account ${r.accountId} created with owner ${r.userId} (${parsed.account.seatLimit} seat${parsed.account.seatLimit === 1 ? '' : 's'}).`);
    console.log('The owner sets their password with "Forgot password" on the login page.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
