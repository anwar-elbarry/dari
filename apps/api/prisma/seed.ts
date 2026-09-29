/* Dev/demo seed: one account, one user per role, one owner, two properties. Idempotent. Never run in production. */
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'demo-password-123';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');

  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  const account =
    (await prisma.account.findFirst({ where: { companyName: 'Demo Conciergerie' } })) ??
    (await prisma.account.create({
      data: { companyName: 'Demo Conciergerie', subscriptionTier: 'GROWTH', seatLimit: 3 },
    }));

  const users: { name: string; email: string; role: Role }[] = [
    { name: 'Demo Manager', email: 'manager@demo.dari.test', role: 'OWNER_MANAGER' },
    { name: 'Demo Staff', email: 'staff@demo.dari.test', role: 'STAFF' },
    { name: 'Demo Accountant', email: 'accountant@demo.dari.test', role: 'ACCOUNTANT' },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, accountId: account.id, passwordHash },
    });
  }

  const owner =
    (await prisma.propertyOwner.findFirst({ where: { accountId: account.id, name: 'Demo Owner' } })) ??
    (await prisma.propertyOwner.create({
      data: { accountId: account.id, name: 'Demo Owner', residency: 'RESIDENT' },
    }));

  const properties = [
    { name: 'Riad Demo', address: '1 Derb Demo, Médina', commune: 'Marrakech', licenseType: 'RIAD' as const, licenseStatus: 'LICENSED' as const },
    { name: 'Appartement Guéliz', address: '2 Rue Demo, Guéliz', commune: 'Marrakech', licenseType: 'FURNISHED_APARTMENT' as const, licenseStatus: 'UNLICENSED' as const },
  ];
  for (const p of properties) {
    const exists = await prisma.property.findFirst({ where: { accountId: account.id, name: p.name } });
    if (!exists) await prisma.property.create({ data: { ...p, accountId: account.id, ownerId: owner.id } });
  }

  console.log('Seeded demo account. Users: manager@ / staff@ / accountant@demo.dari.test');
}

main().finally(() => prisma.$disconnect());
