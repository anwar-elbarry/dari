import { DAY_COUNTER_RULE_KEY } from '../compliance/rules.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { MessagingService } from './messaging.service';
import { StubWhatsAppProvider, WHATSAPP_PROVIDER } from './whatsapp.provider';

requireDatabase();

const PHONE = '+212612345678';
const NIGHT = new Date('2026-01-15T22:30:00Z'); // 22:30 in Casablanca in winter (UTC+1 -> 23:30; either way inside 22:00-07:00)
const NOON = new Date('2026-01-15T12:00:00Z');

describe('messaging (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let messaging: MessagingService;
  let wa: StubWhatsAppProvider;

  const rule = (key: string, value: object, validatedBy: string | null = 'Founder') =>
    t.prisma.ruleConfig.upsert({ where: { key }, update: { value, validatedBy }, create: { key, value, validatedBy } });
  const templates = (over: object = {}) =>
    rule('whatsapp.templates', {
      checkin_link: { name: 'checkin_link_v1', language: 'fr' },
      day_counter_alert: { name: 'day_counter_alert_v1', language: 'fr' },
      share_link: { name: 'share_link_v1', language: 'fr' },
      ...over,
    });
  const quiet = (start: string, end: string) => rule('messaging.quiet_hours', { start, end, timezone: 'Africa/Casablanca' });
  const email = { to: 'manager@alpha.test', subject: 'Subject', text: 'Body with https://x.test/checkin#token=SECRET-TOKEN' };
  const send = (over: object = {}, now = NOON) =>
    messaging.send({ accountId: a.accountId, kind: 'checkin_link', subject: { type: 'CHECKIN_LINK', id: 'link-1' }, whatsappTo: PHONE, variables: ['Riad Atlas', 'https://x.test/checkin#token=SECRET-TOKEN'], ...over }, now);
  const rows = () => t.prisma.messageDelivery.findMany({ orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    t = await createTestApp();
    messaging = t.app.get(MessagingService);
    wa = t.app.get<StubWhatsAppProvider>(WHATSAPP_PROVIDER);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    t.mail.sent.length = 0;
    wa.sent.length = 0;
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    await templates();
    await quiet('00:00', '00:00'); // never quiet, unless a test says so
  });

  describe('MessagingService.send', () => {
    it('sends the approved template by WhatsApp and logs ids only', async () => {
      const r = await send({ actorId: a.users.OWNER_MANAGER.id });
      expect(r).toMatchObject({ channel: 'WHATSAPP', status: 'SENT', skipped: null });
      expect(wa.sent).toEqual([{ to: PHONE, name: 'checkin_link_v1', language: 'fr', variables: ['Riad Atlas', 'https://x.test/checkin#token=SECRET-TOKEN'] }]);
      const [row] = await rows();
      expect(row).toMatchObject({ channel: 'WHATSAPP', template: 'checkin_link_v1', subjectType: 'CHECKIN_LINK', subjectId: 'link-1', status: 'SENT', providerMessageId: expect.stringMatching(/^wamid\.stub-\d+$/), failureCode: null });
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'message.sent' } });
      expect(audit).toMatchObject({ actorId: a.users.OWNER_MANAGER.id, resourceType: 'MessageDelivery', resourceId: row!.id });
      expect(JSON.stringify([await rows(), await t.prisma.auditLog.findMany()])).not.toMatch(/612345678|SECRET-TOKEN|Riad Atlas/);
      expect(t.mail.sent).toHaveLength(0);
    });

    it('a provider failure with no e-mail is recorded with a fixed code', async () => {
      wa.failNext('PROVIDER_AUTH');
      const r = await send();
      expect(r).toMatchObject({ channel: 'WHATSAPP', status: 'FAILED' });
      expect(await rows()).toMatchObject([{ status: 'FAILED', failureCode: 'PROVIDER_AUTH' }]);
    });

    it('falls back to e-mail on every provider failure, and marks the WhatsApp attempt as fallen back', async () => {
      for (const code of ['PROVIDER_UNREACHABLE', 'PROVIDER_AUTH', 'PROVIDER_RATE_LIMITED', 'PROVIDER_REJECTED'] as const) {
        wa.failNext(code);
        const r = await send({ email });
        expect(r).toMatchObject({ channel: 'EMAIL', status: 'SENT' });
      }
      expect(t.mail.sent).toHaveLength(4);
      const all = await rows();
      expect(all.filter((x) => x.channel === 'WHATSAPP').every((x) => x.status === 'FELL_BACK' && x.failureCode !== null)).toBe(true);
      expect(all.filter((x) => x.channel === 'EMAIL').every((x) => x.status === 'SENT' && x.template === 'checkin_link')).toBe(true);
    });

    it('records a failed e-mail with a fixed code and keeps the WhatsApp failure', async () => {
      wa.failNext();
      jest.spyOn(t.mail, 'send').mockRejectedValueOnce(new Error('HTTP 500 for manager@alpha.test'));
      const r = await send({ email });
      expect(r).toMatchObject({ channel: 'EMAIL', status: 'FAILED' });
      expect(await rows()).toMatchObject([{ channel: 'WHATSAPP', status: 'FAILED' }, { channel: 'EMAIL', status: 'FAILED', failureCode: 'MAIL_FAILED' }]);
      expect(JSON.stringify(await rows())).not.toContain('manager@alpha.test');
    });

    it.each([
      ['no number', { whatsappTo: null }, 'NO_NUMBER'],
      ['no approved template', {}, 'NO_TEMPLATE'],
    ])('%s: no WhatsApp, e-mail when given', async (_n, over, skipped) => {
      if (skipped === 'NO_TEMPLATE') await templates({ checkin_link: { name: null, language: 'fr' } });
      expect(await send({ ...over, email })).toMatchObject({ channel: 'EMAIL', status: 'SENT', skipped });
      expect(wa.sent).toHaveLength(0);
      expect(await send({ ...over })).toEqual({ channel: null, status: null, deliveryId: null, skipped });
    });

    it('holds WhatsApp during quiet hours unless urgent; e-mail is not held', async () => {
      await quiet('22:00', '07:00');
      expect(await send({ email }, NIGHT)).toMatchObject({ channel: 'EMAIL', skipped: 'QUIET_HOURS' });
      expect(wa.sent).toHaveLength(0);
      expect(await send({ urgent: true }, NIGHT)).toMatchObject({ channel: 'WHATSAPP', status: 'SENT' });
      expect(await send({}, NOON)).toMatchObject({ channel: 'WHATSAPP', status: 'SENT' });
    });

    it('caps WhatsApp per account per day; failed sends do not count; e-mail is never capped; another account is separate; the next day resets', async () => {
      await rule('messaging.daily_cap', { messages: 2 });
      wa.failNext();
      await send(); // fails: does not use the cap
      await send();
      await send();
      const third = await send({ email });
      expect(third).toMatchObject({ channel: 'EMAIL', skipped: 'CAP_REACHED' });
      expect(wa.sent).toHaveLength(2);
      expect(await messaging.send({ accountId: b.accountId, kind: 'checkin_link', subject: { type: 'CHECKIN_LINK', id: 'x' }, whatsappTo: PHONE, variables: ['P', 'u'] }, NOON)).toMatchObject({ channel: 'WHATSAPP', status: 'SENT' });
      const tomorrow = new Date(Date.now() + 26 * 3_600_000);
      expect(await send({}, tomorrow)).toMatchObject({ channel: 'WHATSAPP', status: 'SENT' });
    });

    it('flattens template variables to single-line text', async () => {
      await send({ variables: ['Riad\n\tAtlas   Deux', 'u'] });
      expect(wa.sent[0]!.variables[0]).toBe('Riad Atlas Deux');
    });
  });

  describe('delivery reports', () => {
    const report = (id: string, status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED') => messaging.applyReports([{ providerMessageId: id, status }]);
    const ids = async () => (await rows()).map((r) => r.providerMessageId!);

    it('moves a message forward only, and a replay changes nothing', async () => {
      await send();
      const [id] = await ids();
      expect(await report(id!, 'DELIVERED')).toBe(1);
      expect(await report(id!, 'DELIVERED')).toBe(0);
      expect(await report(id!, 'SENT')).toBe(0);
      expect(await report(id!, 'READ')).toBe(1);
      expect((await rows())[0]!.status).toBe('READ');
    });

    it('a failure reported before delivery is recorded; after delivery it is stale', async () => {
      await send();
      await send();
      const [first, second] = await ids();
      expect(await report(first!, 'FAILED')).toBe(1);
      expect(await rows()).toMatchObject([{ status: 'FAILED', failureCode: 'REPORTED_FAILED' }, { status: 'SENT' }]);
      await report(second!, 'DELIVERED');
      expect(await report(second!, 'FAILED')).toBe(0);
      expect((await rows())[1]!.status).toBe('DELIVERED');
    });

    it('ignores an id it does not know', async () => {
      expect(await report('wamid.unknown', 'READ')).toBe(0);
    });
  });

  describe('notification preferences and the WhatsApp number', () => {
    it('default to e-mail; the number is never returned in full', async () => {
      const r = (await a.as.OWNER_MANAGER.get('/api/me/notification-preferences').expect(200)).body;
      expect(r).toEqual({ whatsapp: { enabled: true, ready: true, checkinLink: true, shareLink: true }, phone: null, preferences: [{ alertType: 'day_counter.amber', channel: 'EMAIL' }, { alertType: 'day_counter.red', channel: 'EMAIL' }] });
      const withPhone = (await a.as.OWNER_MANAGER.put('/api/me/phone', { phone: '+212 6 12 34 56 78' }).expect(200)).body;
      expect(withPhone.phone).toBe('+212•••••••78');
      expect(JSON.stringify(withPhone)).not.toContain('612345678');
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: a.users.OWNER_MANAGER.id } })).phone).toBe(PHONE);
    });

    it('WhatsApp needs a number; a malformed number is refused; removing the number resets the choices', async () => {
      const pref = (channel: string, alertType = 'day_counter.red') => a.as.OWNER_MANAGER.put('/api/me/notification-preferences', { alertType, channel });
      expect((await pref('WHATSAPP').expect(422)).body.error.code).toBe('PHONE_REQUIRED');
      await a.as.OWNER_MANAGER.put('/api/me/phone', { phone: '0612345678' }).expect(400);
      await a.as.OWNER_MANAGER.put('/api/me/phone', { phone: '+33 (0)1 23 45 67 89' }).expect(400);
      await a.as.OWNER_MANAGER.put('/api/me/phone', { phone: PHONE }).expect(200);
      await pref('WHATSAPP').expect(200);
      await pref('BOTH', 'day_counter.amber').expect(200);
      const cleared = (await a.as.OWNER_MANAGER.put('/api/me/phone', { phone: null }).expect(200)).body;
      expect(cleared.phone).toBeNull();
      expect(cleared.preferences.map((p: { channel: string }) => p.channel)).toEqual(['EMAIL', 'EMAIL']);
      expect(await t.prisma.auditLog.count({ where: { action: 'user.phone_changed' } })).toBe(2); // set, then removed: the refusals write nothing
    });

    it('refuses an unknown alert type or channel, is per user, and is open to every signed-in role', async () => {
      await a.as.OWNER_MANAGER.put('/api/me/notification-preferences', { alertType: 'day_counter.blue', channel: 'EMAIL' }).expect(400);
      await a.as.OWNER_MANAGER.put('/api/me/notification-preferences', { alertType: 'day_counter.red', channel: 'SMS' }).expect(400);
      await a.as.OWNER_MANAGER.put('/api/me/notification-preferences', { alertType: 'day_counter.red', channel: 'NONE' }).expect(200);
      const staff = (await a.as.STAFF.get('/api/me/notification-preferences').expect(200)).body;
      expect(staff.preferences[1]).toEqual({ alertType: 'day_counter.red', channel: 'EMAIL' });
      await a.as.ACCOUNTANT.get('/api/me/notification-preferences').expect(200);
      await a.as.ANON.get('/api/me/notification-preferences').expect(401);
    });
  });

  describe('day-counter alerts', () => {
    let propertyId: string;
    const year = new Date().getUTCFullYear();
    const csv = (from: number, to: number, code: string) => `check_in,check_out,platform,confirmation_code\n${year}-03-${String(from).padStart(2, '0')},${year}-03-${String(to).padStart(2, '0')},AIRBNB,${code}\n`;
    const importCsv = (text: string) => a.as.OWNER_MANAGER.upload(`/api/properties/${propertyId}/imports`, text).expect(201);
    const alerts = () => t.prisma.notification.findMany({ orderBy: { type: 'asc' } });
    const choose = async (channel: string, alertType = 'day_counter.amber') => {
      await a.as.OWNER_MANAGER.put('/api/me/phone', { phone: PHONE }).expect(200);
      await a.as.OWNER_MANAGER.put('/api/me/notification-preferences', { alertType, channel }).expect(200);
    };

    beforeEach(async () => {
      await rule(DAY_COUNTER_RULE_KEY, { amber: 5, red: 8, cap: 10, period: 'CALENDAR_YEAR' }, null);
      const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'O', residency: 'RESIDENT' } });
      propertyId = (await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad Yasmine', address: 'x', commune: 'Marrakech', licenseType: 'RIAD', licenseStatus: 'UNLICENSED' } })).id;
    });

    it('with no choice made it stays an e-mail, as before, and is logged as one delivery', async () => {
      await importCsv(csv(1, 8, 'A'));
      expect(t.mail.sent).toHaveLength(1);
      expect(wa.sent).toHaveLength(0);
      expect((await alerts())[0]).toMatchObject({ sentVia: ['dashboard', 'email'] });
      expect(await rows()).toMatchObject([{ channel: 'EMAIL', subjectType: 'ALERT', status: 'SENT' }]);
    });

    it('WhatsApp: the template gets the property, the nights and the level; no e-mail goes out; sentVia says so', async () => {
      await choose('WHATSAPP');
      await importCsv(csv(1, 8, 'A'));
      expect(wa.sent).toMatchObject([{ to: PHONE, name: 'day_counter_alert_v1', variables: ['Riad Yasmine', '7', 'préventive'] }]);
      expect(t.mail.sent).toHaveLength(0);
      expect((await alerts())[0]).toMatchObject({ sentVia: ['dashboard', 'whatsapp'] });
    });

    it('WhatsApp that fails falls back to e-mail', async () => {
      await choose('WHATSAPP');
      wa.failNext();
      await importCsv(csv(1, 8, 'A'));
      expect(t.mail.sent).toHaveLength(1);
      expect((await alerts())[0]).toMatchObject({ sentVia: ['dashboard', 'email'] });
      expect((await rows()).map((r) => [r.channel, r.status])).toEqual([['WHATSAPP', 'FELL_BACK'], ['EMAIL', 'SENT']]);
    });

    it('both: one of each, without a fallback for the WhatsApp one', async () => {
      await choose('BOTH');
      await importCsv(csv(1, 8, 'A'));
      expect(wa.sent).toHaveLength(1);
      expect(t.mail.sent).toHaveLength(1);
      expect((await alerts())[0]).toMatchObject({ sentVia: ['dashboard', 'email', 'whatsapp'] });
    });

    it('none: the dashboard only', async () => {
      await choose('NONE');
      await importCsv(csv(1, 8, 'A'));
      expect(t.mail.sent).toHaveLength(0);
      expect(wa.sent).toHaveLength(0);
      expect((await alerts())[0]).toMatchObject({ sentVia: ['dashboard'] });
    });

    it('a critical alert is urgent and uses WhatsApp in quiet hours; an early warning waits and goes by e-mail', async () => {
      await quiet('00:00', '23:59'); // quiet for every minute of the day but the last
      await choose('WHATSAPP', 'day_counter.red');
      await a.as.OWNER_MANAGER.put('/api/me/notification-preferences', { alertType: 'day_counter.amber', channel: 'WHATSAPP' }).expect(200);

      await importCsv(csv(1, 7, 'AMBER')); // 6 nights: early warning only
      expect(wa.sent).toHaveLength(0);
      expect(t.mail.sent).toHaveLength(1);

      await importCsv(csv(10, 14, 'RED')); // 10 nights in total: the critical threshold
      expect(wa.sent).toMatchObject([{ variables: ['Riad Yasmine', '10', 'critique'] }]);
      expect(t.mail.sent).toHaveLength(1);
    });
  });
});
