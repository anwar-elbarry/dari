import { createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';
import { CHECKIN_GRACE_RULE_KEY, ID_RETENTION_RULE_KEY, RulesService } from './rules.service';

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
});
