import { createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';
import { SEAT_LIMITS_RULE_KEY, CHECKIN_GRACE_RULE_KEY, DAILY_CAP_RULE_KEY, LICENSE_DOCUMENT_RETENTION_RULE_KEY, QUIET_HOURS_RULE_KEY, WHATSAPP_TEMPLATES_RULE_KEY, FICHE_RETENTION_RULE_KEY, ID_RETENTION_RULE_KEY, REGISTER_RETENTION_RULE_KEY, RulesService, SHARE_MAX_HOURS_RULE_KEY, SHARE_MIN_HOURS_RULE_KEY } from './rules.service';

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

  describe('Phase 6 rules', () => {
    it('reads the seat policy: the founder figures, the Accountant not counted', async () => {
      await set(SEAT_LIMITS_RULE_KEY, { limits: { STARTER: 1, GROWTH: 3, CONCIERGERIE: 6 }, countedRoles: ['OWNER_MANAGER', 'STAFF'] });
      expect(await rules.seatPolicy()).toEqual({ limits: { STARTER: 1, GROWTH: 3, CONCIERGERIE: 6 }, countedRoles: ['OWNER_MANAGER', 'STAFF'], validated: false });
    });

    it('drops malformed seat figures and never counts the Accountant by default', async () => {
      await set(SEAT_LIMITS_RULE_KEY, { limits: { STARTER: 0, GROWTH: '3', CONCIERGERIE: 6, OTHER: 9 }, countedRoles: ['BOSS'] });
      expect(await rules.seatPolicy()).toEqual({ limits: { CONCIERGERIE: 6 }, countedRoles: ['OWNER_MANAGER', 'STAFF'], validated: false });
      await t.prisma.ruleConfig.deleteMany({ where: { key: SEAT_LIMITS_RULE_KEY } });
      expect(await rules.seatPolicy()).toEqual({ limits: {}, countedRoles: ['OWNER_MANAGER', 'STAFF'], validated: false });
    });

    it('applies a licence-document retention only when it is a valid, validated number (no default exists)', async () => {
      expect(await rules.licenseDocumentRetention()).toEqual({ days: null, validated: false, enforceable: null });
      await set(LICENSE_DOCUMENT_RETENTION_RULE_KEY, { days: 1825 });
      expect(await rules.licenseDocumentRetention()).toEqual({ days: 1825, validated: false, enforceable: null });
      await set(LICENSE_DOCUMENT_RETENTION_RULE_KEY, { days: 1825 }, 'Counsel');
      expect(await rules.licenseDocumentRetention()).toEqual({ days: 1825, validated: true, enforceable: 1825 });
      await set(LICENSE_DOCUMENT_RETENTION_RULE_KEY, { days: 0 }, 'Counsel');
      expect(await rules.licenseDocumentRetention()).toEqual({ days: null, validated: true, enforceable: null });
    });

    it('keeps only the WhatsApp templates that are approved and well formed; the rest go by e-mail', async () => {
      expect(await rules.whatsappTemplates()).toEqual({ templates: {}, validated: false });
      await set(
        WHATSAPP_TEMPLATES_RULE_KEY,
        {
          checkin_link: { name: 'checkin_link_v1', language: 'fr' },
          day_counter_alert: { name: 'Alert With Spaces', language: 'fr' },
          share_link: { name: 'share_link_v1', language: 'french' },
          unknown_kind: { name: 'x', language: 'fr' },
        },
        'Founder',
      );
      expect(await rules.whatsappTemplates()).toEqual({ templates: { checkin_link: { name: 'checkin_link_v1', language: 'fr' } }, validated: true });
    });

    it('reads the quiet hours; a missing or malformed window falls back to 22:00-07:00 Africa/Casablanca, unvalidated', async () => {
      const fallback = { startMinute: 1320, endMinute: 420, timezone: 'Africa/Casablanca', validated: false };
      await t.prisma.ruleConfig.deleteMany({ where: { key: QUIET_HOURS_RULE_KEY } });
      expect(await rules.quietHours()).toEqual(fallback);
      await set(QUIET_HOURS_RULE_KEY, { start: '23:30', end: '06:15', timezone: 'Europe/Paris' }, 'Founder');
      expect(await rules.quietHours()).toEqual({ startMinute: 1410, endMinute: 375, timezone: 'Europe/Paris', validated: true });
      for (const bad of [{ start: '24:00', end: '07:00', timezone: 'Africa/Casablanca' }, { start: '22:00', end: '7', timezone: 'Africa/Casablanca' }, { start: '22:00', end: '07:00', timezone: 'Nowhere/City' }, {}]) {
        await set(QUIET_HOURS_RULE_KEY, bad, 'Founder');
        expect(await rules.quietHours()).toEqual(fallback);
      }
    });

    it('reads the daily cap; a missing or malformed value falls back to 200, unvalidated', async () => {
      await t.prisma.ruleConfig.deleteMany({ where: { key: DAILY_CAP_RULE_KEY } });
      expect(await rules.dailyCap()).toEqual({ messages: 200, validated: false });
      await set(DAILY_CAP_RULE_KEY, { messages: 50 }, 'Founder');
      expect(await rules.dailyCap()).toEqual({ messages: 50, validated: true });
      for (const bad of [{ messages: 0 }, { messages: '50' }, { messages: 1.5 }, {}]) {
        await set(DAILY_CAP_RULE_KEY, bad, 'Founder');
        expect(await rules.dailyCap()).toEqual({ messages: 200, validated: false });
      }
    });
  });
});
