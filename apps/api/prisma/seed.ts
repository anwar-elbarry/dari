/* Dev/demo seed: one account, one user per role, one owner, two properties. Idempotent. Never run in production. */
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'demo-password-123';

async function main() {
  // Known demo passwords: only on a local database, or when explicitly allowed (CI, throwaway DBs).
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  const local = ['localhost', '127.0.0.1', '::1', 'db', 'postgres'].includes(host);
  if (process.env.NODE_ENV === 'production' || (!local && process.env.ALLOW_DEMO_SEED !== 'true')) {
    throw new Error('Refusing to seed demo users: not a local database (set ALLOW_DEMO_SEED=true for a disposable one).');
  }

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

  // Synthetic consent wording so the guest flow can be tried locally. It is NOT counsel's text: never use it
  // with real guests. Production wording is inserted by counsel-approved SQL (see docs/phase-3.md).
  const dev = [
    { locale: 'fr', body: '[TEXTE DE DÉVELOPPEMENT, non approuvé] Je consens au traitement de mes données pour la fiche de police.' },
    { locale: 'en', body: '[DEVELOPMENT TEXT, not approved] I consent to my data being processed for the police form.' },
  ];
  for (const c of dev) {
    await prisma.consentText.upsert({
      where: { version_locale: { version: 'dev-1', locale: c.locale } },
      update: {},
      create: { version: 'dev-1', locale: c.locale, body: c.body, approvedBy: 'dev-seed', approvedAt: new Date('2026-01-01T00:00:00Z') },
    });
  }

  console.log('Seeded demo account. Users: manager@ / staff@ / accountant@demo.dari.test');
}

main().finally(() => prisma.$disconnect());
