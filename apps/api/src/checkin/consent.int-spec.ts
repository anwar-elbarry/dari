import { createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';
import { ConsentService } from './consent.service';

requireDatabase();

describe('ConsentService (integration)', () => {
  let t: TestApp;
  let consent: ConsentService;
  const day = 86_400_000;

  beforeAll(async () => {
    t = await createTestApp();
    consent = t.app.get(ConsentService);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
  });

  const add = (version: string, locale: string, approvedAt: Date | null, body = `${version}-${locale}`) =>
    t.prisma.consentText.create({ data: { version, locale, body, approvedBy: approvedAt ? 'counsel' : null, approvedAt } });

  it('serves nothing when no text is approved (the guest flow must then refuse to start)', async () => {
    expect(await consent.current('fr')).toBeNull();
    await add('v1', 'fr', null);
    expect(await consent.current('fr')).toBeNull();
  });

  it('never serves an unapproved or not-yet-effective text', async () => {
    const draft = await add('v2', 'fr', null);
    await add('v3', 'fr', new Date(Date.now() + 7 * day));
    expect(await consent.current('fr')).toBeNull();
    expect(await consent.approvedById(draft.id)).toBeNull();
  });

  it('serves the latest approved text per language', async () => {
    await add('v1', 'fr', new Date(Date.now() - 30 * day));
    const v2 = await add('v2', 'fr', new Date(Date.now() - 1 * day));
    await add('v9-draft', 'fr', null);
    await add('v1', 'en', new Date(Date.now() - 30 * day));

    expect(await consent.current('fr')).toMatchObject({ id: v2.id, version: 'v2', locale: 'fr', body: 'v2-fr' });
    expect(await consent.current('en')).toMatchObject({ version: 'v1', locale: 'en' });
    expect(await consent.current('ar')).toBeNull();
  });

  it('confirms a wording by id only when it is an approved row', async () => {
    const ok = await add('v1', 'en', new Date(Date.now() - day));
    expect(await consent.approvedById(ok.id)).toMatchObject({ version: 'v1' });
    expect(await consent.approvedById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('keeps one row per version and language', async () => {
    await add('v1', 'fr', new Date());
    await expect(add('v1', 'fr', new Date())).rejects.toMatchObject({ code: 'P2002' });
  });
});
