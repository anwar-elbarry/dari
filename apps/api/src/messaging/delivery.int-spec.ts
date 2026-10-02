import { StorageService } from '../storage/storage.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { MESSAGING_COUNTER } from './messaging.service';
import { StubWhatsAppProvider, WHATSAPP_PROVIDER } from './whatsapp.provider';

requireDatabase();

const PHONE = '+212612345678';
const DAY = 86_400_000;

/** The check-in link and the Secure Share link sent by WhatsApp: the guest's or the authority's number is used once and kept nowhere. */
describe('link delivery by WhatsApp (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let wa: StubWhatsAppProvider;
  let bookingId: string;
  let propertyId: string;

  const rule = (key: string, value: object) => t.prisma.ruleConfig.upsert({ where: { key }, update: { value, validatedBy: 'Founder' }, create: { key, value, validatedBy: 'Founder' } });
  const deliveries = () => t.prisma.messageDelivery.findMany({ orderBy: { createdAt: 'asc' } });
  const create = (body: object = {}, client = a.as.OWNER_MANAGER) => client.post(`/api/bookings/${bookingId}/checkin-links`, body);

  beforeAll(async () => {
    t = await createTestApp();
    wa = t.app.get<StubWhatsAppProvider>(WHATSAPP_PROVIDER);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    wa.reset();
    t.mail.sent.length = 0;
    (t.app.get(MESSAGING_COUNTER) as unknown as { entries?: Map<string, unknown> }).entries?.clear(); // the per-number daily limit is tested on its own (a Redis counter was flushed above)
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    await rule('whatsapp.templates', { checkin_link: { name: 'checkin_link_v1', language: 'fr' }, share_link: { name: 'share_link_v1', language: 'fr' } });
    await rule('messaging.quiet_hours', { start: '00:00', end: '00:00', timezone: 'Africa/Casablanca' });
    await rule('checkin.link_grace_hours', { hours: 48 });
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Owner', residency: 'RESIDENT' } });
    propertyId = (await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad  Atlas', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } })).id;
    bookingId = (await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(Date.now() + 10 * DAY), checkOut: new Date(Date.now() + 13 * DAY), source: 'DIRECT' } })).id;
  });

  describe('check-in links', () => {
    it('without a number nothing is sent and the response has no delivery', async () => {
      const res = await create().expect(201);
      expect(res.body.delivery).toBeNull();
      expect(wa.sent).toHaveLength(0);
      expect(await deliveries()).toHaveLength(0);
    });

    it('sends the link with the property name, keeps the number nowhere, and reports the status', async () => {
      const res = await create({ whatsappTo: '+212 6 12 34 56 78' }).expect(201);
      expect(res.body.delivery).toEqual({ channel: 'WHATSAPP', status: 'SENT', skipped: null });
      expect(wa.sent).toEqual([{ to: PHONE, name: 'checkin_link_v1', language: 'fr', variables: ['Riad Atlas', res.body.url] }]);
      expect(res.body.url).toContain('/checkin#token=');

      const stored = JSON.stringify([await deliveries(), await t.prisma.auditLog.findMany(), await t.prisma.checkInLink.findMany()]);
      expect(stored).not.toMatch(/612345678|token=/);
      expect(JSON.stringify(res.body.delivery)).not.toMatch(/612345678/);

      const list = (await a.as.OWNER_MANAGER.get(`/api/checkin-links/${res.body.id}/deliveries`).expect(200)).body;
      expect(list).toMatchObject([{ channel: 'WHATSAPP', status: 'SENT', failureCode: null }]);
      expect(JSON.stringify(list)).not.toMatch(/612345678|token=|checkin_link_v1/);
    });

    it('Staff can send it too', async () => {
      const res = await create({ whatsappTo: PHONE }, a.as.STAFF).expect(201);
      expect(res.body.delivery.status).toBe('SENT');
    });

    it('a property name written to look like a link or a message cannot carry one into the template', async () => {
      await t.prisma.property.update({ where: { id: propertyId }, data: { name: 'Your account is blocked, open http://evil.example/login or write a@evil.example' } });
      await create({ whatsappTo: PHONE }).expect(201);
      const name = wa.sent[0]!.variables[0]!;
      expect(name).not.toMatch(/[:/@.]/);
      expect(name.length).toBeLessThanOrEqual(60);
    });

    it('a malformed number is refused before any link is made', async () => {
      for (const whatsappTo of ['0612345678', 'abc', '+33 (0)1 23 45 67 89', '']) {
        expect((await create({ whatsappTo }).expect(400)).body.error.code).toBe('INVALID_PHONE');
      }
      expect(await t.prisma.checkInLink.count()).toBe(0);
    });

    it('when WhatsApp fails the link still exists and the response says it was not delivered', async () => {
      wa.failNext('PROVIDER_UNREACHABLE');
      const res = await create({ whatsappTo: PHONE }).expect(201);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.delivery).toEqual({ channel: 'WHATSAPP', status: 'FAILED', skipped: null });
      const list = (await a.as.OWNER_MANAGER.get(`/api/checkin-links/${res.body.id}/deliveries`).expect(200)).body;
      expect(list).toMatchObject([{ status: 'FAILED', failureCode: 'PROVIDER_UNREACHABLE' }]);
    });

    it('when WhatsApp is not ready (no approved template) the link is returned and the reason is given', async () => {
      await rule('whatsapp.templates', { checkin_link: { name: null, language: 'fr' } });
      const res = await create({ whatsappTo: PHONE }).expect(201);
      expect(res.body.delivery).toEqual({ channel: null, status: null, skipped: 'NO_TEMPLATE' });
      expect(wa.sent).toHaveLength(0);
    });

    it('resending mints a new token and can send it; the old one stops working', async () => {
      const first = (await create().expect(201)).body;
      const res = await a.as.OWNER_MANAGER.post(`/api/checkin-links/${first.id}/resend`, { whatsappTo: PHONE }).expect(201);
      expect(res.body.token).not.toBe(first.token);
      expect(res.body.delivery.status).toBe('SENT');
      expect(wa.sent[0]!.variables[1]).toBe(res.body.url);
      expect(await t.prisma.checkInLink.count({ where: { revokedAt: null } })).toBe(1);
    });

    it('the delivery list is for this account only, and closed to the Accountant', async () => {
      const res = await create({ whatsappTo: PHONE }).expect(201);
      await b.as.OWNER_MANAGER.get(`/api/checkin-links/${res.body.id}/deliveries`).expect(404);
      await a.as.ACCOUNTANT.get(`/api/checkin-links/${res.body.id}/deliveries`).expect(403);
      expect((await a.as.STAFF.get(`/api/checkin-links/${res.body.id}/deliveries`).expect(200)).body).toHaveLength(1);
    });
  });

  describe('Secure Share links', () => {
    let guestId: string;

    beforeEach(async () => {
      const link = await t.prisma.checkInLink.create({ data: { accountId: a.accountId, bookingId, tokenHash: `h-${Math.random()}`, expiresAt: new Date(Date.now() + DAY), createdBy: a.users.OWNER_MANAGER.id, maxGuests: 1 } });
      const guest = await t.prisma.guestCheckIn.create({ data: { accountId: a.accountId, bookingId, propertyId, linkId: link.id, guestIndex: 1, status: 'VERIFIED', fullName: 'Anna Eriksson', submittedAt: new Date() } });
      const pdf = await t.app.get(StorageService).put(a.accountId, 'FICHE_PDF', Buffer.from('%PDF-1.4 stub'));
      await t.prisma.ficheDePolice.create({ data: { accountId: a.accountId, guestCheckInId: guest.id, pdfObjectId: pdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64) } });
      guestId = guest.id;
    });
    const share = (extra: object = {}) => a.as.OWNER_MANAGER.post('/api/shares', { resourceType: 'FICHE_DE_POLICE', guestId, expiresInHours: 24, recipientLabel: 'Prefecture de police', ...extra });

    it('sends the link with the company name, never the private label, and stores no number', async () => {
      const res = await share({ whatsappTo: PHONE }).expect(201);
      expect(res.body.delivery).toEqual({ channel: 'WHATSAPP', status: 'SENT', skipped: null });
      expect(wa.sent).toEqual([{ to: PHONE, name: 'share_link_v1', language: 'fr', variables: ['Alpha Conciergerie', res.body.url] }]);
      expect(JSON.stringify(wa.sent)).not.toContain('Prefecture');
      expect(JSON.stringify([await deliveries(), await t.prisma.auditLog.findMany(), await t.prisma.shareLink.findMany()])).not.toMatch(/612345678|token=/);
      expect((await deliveries())[0]).toMatchObject({ subjectType: 'SHARE_LINK', subjectId: res.body.id });
    });

    it('is optional, and a malformed number is refused before any link is made', async () => {
      expect((await share().expect(201)).body.delivery).toBeNull();
      await share({ whatsappTo: 'nope' }).expect(400);
      expect(await t.prisma.shareLink.count()).toBe(1);
    });

    it('a failure leaves the link usable', async () => {
      wa.failNext();
      const res = await share({ whatsappTo: PHONE }).expect(201);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.delivery.status).toBe('FAILED');
    });
  });
});
