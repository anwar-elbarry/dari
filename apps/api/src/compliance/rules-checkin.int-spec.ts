import { createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';
import { CHECKIN_GRACE_RULE_KEY, FICHE_RETENTION_RULE_KEY, ID_RETENTION_RULE_KEY, REGISTER_RETENTION_RULE_KEY, RulesService, SHARE_MAX_HOURS_RULE_KEY, SHARE_MIN_HOURS_RULE_KEY } from './rules.service';

requireDatabase();

describe('retention and link-lifetime rules (integration)', () => {
  let t: TestApp;
  let rules: RulesService;

  beforeAll(async () => {
    t = await createTestApp();
    rules = t.app.get(RulesService);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
  });

  const set = (key: string, value: object, validatedBy: string | null = null) =>
    t.prisma.ruleConfig.upsert({ where: { key }, update: { value, validatedBy }, create: { key, value, validatedBy } });

  it('reads the values from RuleConfig, reporting whether counsel has validated them', async () => {
    await set(ID_RETENTION_RULE_KEY, { days: 14 });
    await set(CHECKIN_GRACE_RULE_KEY, { hours: 24 }, 'Counsel');
    expect(await rules.idRetention()).toEqual({ days: 14, validated: false });
    expect(await rules.checkinGrace()).toEqual({ hours: 24, validated: true });
  });

  it('falls back to the plan defaults, unvalidated, when a row is missing', async () => {
    expect(await rules.idRetention()).toEqual({ days: 30, validated: false });
    expect(await rules.checkinGrace()).toEqual({ hours: 48, validated: false });
  });

  it.each([[{ days: 0 }], [{ days: 400 }], [{ days: '30' }], [{ days: 2.5 }], [{}]])('refuses a malformed retention value %j', async (value) => {
    await set(ID_RETENTION_RULE_KEY, value, 'Counsel');
    expect(await rules.idRetention()).toEqual({ days: 30, validated: false });
  });

  it('the migration seeds both rules with the plan defaults, unvalidated', async () => {
    // resetDatabase truncated them; re-create exactly what the migration inserts to prove the shape parses.
    await set(ID_RETENTION_RULE_KEY, { days: 30 });
    await set(CHECKIN_GRACE_RULE_KEY, { hours: 48 });
    expect(await rules.idRetention()).toEqual({ days: 30, validated: false });
    expect(await rules.checkinGrace()).toEqual({ hours: 48, validated: false });
  });

  describe('Fiche and register retention (no default: counsel decides)', () => {
    it('reports "not set" when the row is missing or seeded with null', async () => {
      expect(await rules.ficheRetention()).toEqual({ days: null, validated: false, enforceable: null });
      await set(FICHE_RETENTION_RULE_KEY, { days: null });
      await set(REGISTER_RETENTION_RULE_KEY, { days: null });
      expect(await rules.ficheRetention()).toEqual({ days: null, validated: false, enforceable: null });
      expect(await rules.policeRegisterRetention()).toEqual({ days: null, validated: false, enforceable: null });
    });

    it('enforces a period only when it is valid and validated', async () => {
      await set(FICHE_RETENTION_RULE_KEY, { days: 730 });
      await set(REGISTER_RETENTION_RULE_KEY, { days: 1825 }, 'Counsel');
      expect(await rules.ficheRetention()).toEqual({ days: 730, validated: false, enforceable: null });
      expect(await rules.policeRegisterRetention()).toEqual({ days: 1825, validated: true, enforceable: 1825 });
    });

    it.each([[{ days: 0 }], [{ days: 3651 }], [{ days: '30' }], [{ days: 2.5 }], [{}]])('refuses a malformed value %j', async (value) => {
      await set(FICHE_RETENTION_RULE_KEY, value, 'Counsel');
      expect(await rules.ficheRetention()).toEqual({ days: null, validated: true, enforceable: null });
    });
  });

  describe('Secure Share lifetime bounds', () => {
    it('reads both bounds; validated only when counsel validated both', async () => {
      await set(SHARE_MIN_HOURS_RULE_KEY, { hours: 12 }, 'Counsel');
      await set(SHARE_MAX_HOURS_RULE_KEY, { hours: 48 });
      expect(await rules.shareLifetime()).toEqual({ minHours: 12, maxHours: 48, validated: false });
      await set(SHARE_MAX_HOURS_RULE_KEY, { hours: 48 }, 'Counsel');
      expect(await rules.shareLifetime()).toEqual({ minHours: 12, maxHours: 48, validated: true });
    });

    it('falls back to 24 and 72 hours, unvalidated, when a row is missing', async () => {
      await set(SHARE_MIN_HOURS_RULE_KEY, { hours: 12 }, 'Counsel');
      expect(await rules.shareLifetime()).toEqual({ minHours: 24, maxHours: 72, validated: false });
    });

    it.each([[{ hours: 0 }, { hours: 72 }], [{ hours: 24 }, { hours: 169 }], [{ hours: 24 }, { hours: 'x' }], [{ hours: 80 }, { hours: 72 }], [{ hours: 24 }, {}]])('refuses %j / %j (never a permanent or inverted range)', async (min, max) => {
      await set(SHARE_MIN_HOURS_RULE_KEY, min, 'Counsel');
      await set(SHARE_MAX_HOURS_RULE_KEY, max, 'Counsel');
      expect(await rules.shareLifetime()).toEqual({ minHours: 24, maxHours: 72, validated: false });
    });
  });
});
