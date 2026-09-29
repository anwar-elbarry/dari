import request from 'supertest';
import sharp from 'sharp';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../common/csrf.guard';
import { MemoryObjectStore } from '../storage/memory-object-store';
import { OBJECT_STORE } from '../storage/object-store';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { FicheService } from './fiche.service';
import { mapWorkerResponse, OcrClient } from './ocr.client';

requireDatabase();

/** The public guest routes are on the internet with only a link as credential: what can an attacker do with them? */
const DAY = 86_400_000;
const TOKEN = 'X-Checkin-Token';
const photo = () => sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 210, g: 210, b: 210 } } }).jpeg().toBuffer();
const form = (over: Record<string, unknown> = {}) => ({
  docType: 'PASSPORT', fullName: 'Anna Eriksson', nationality: 'SWE', docNumber: 'L898902C3', dob: '1974-08-12', declaredMoroccanNationality: false,
  entryStampNumber: 'CMN-1', cityOfOrigin: 'Stockholm', nextDestination: 'Essaouira', profession: 'Engineer', consent: true, ...over,
});

async function setup(t: TestApp, a: SeededAccount, maxGuests = 2) {
  const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Owner', residency: 'RESIDENT' } });
  const property = await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } });
  const booking = await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId: property.id, checkIn: new Date(Date.now() + 10 * DAY), checkOut: new Date(Date.now() + 13 * DAY), source: 'DIRECT', partySize: maxGuests } });
  await t.prisma.ruleConfig.createMany({ data: [{ key: 'retention.id_images_days', value: { days: 30 } }, { key: 'checkin.link_grace_hours', value: { hours: 48 } }] });
  const consent = await t.prisma.consentText.create({ data: { version: 'v1', locale: 'fr', body: 'Je consens.', approvedBy: 'c', approvedAt: new Date(Date.now() - DAY) } });
  return { booking, consentId: consent.id };
}

describe('guest routes under abuse (integration)', () => {
  describe('per-link caps (rate limiting off, so only the link counters act)', () => {
    let t: TestApp;
    let a: SeededAccount;
    let bookingId: string;
    let consentId: string;
    let store: MemoryObjectStore;

    beforeAll(async () => {
      t = await createTestApp();
      store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
    });
    afterAll(async () => {
      await t.app.close();
    });
    beforeEach(async () => {
      jest.restoreAllMocks();
      jest.spyOn(t.app.get(OcrClient), 'extract').mockResolvedValue(mapWorkerResponse(null));
      jest.spyOn(FicheService.prototype, 'generateInBackground').mockImplementation(() => undefined);
      for (const key of store.keys()) await store.delete(key);
      await resetDatabase(t.prisma, t.redis);
      a = await seedAccount(t, 'Alpha');
      ({ booking: { id: bookingId }, consentId } = await setup(t, a));
    });

    const link = async (maxGuests = 2) => (await a.as.OWNER_MANAGER.post(`/api/bookings/${bookingId}/checkin-links`, { maxGuests }).expect(201)).body as { token: string };
    const up = async (token: string, draftId?: string) => {
      let req = request(t.app.getHttpServer()).post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, token);
      if (draftId) req = req.field('draftId', draftId);
      return req.attach('file', await photo(), { filename: 'p.jpg', contentType: 'image/jpeg' });
    };
    const send = (token: string, body: object) => request(t.app.getHttpServer()).post('/api/checkin/submit').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, token).send(body);

    it('bounds the photos a held link can push into storage: 10 per window, then 429', async () => {
      const { token } = await link(); // 2 guests: at most 4 open drafts of 3 photos = 12 possible, capped at 10
      const drafts: string[] = [];
      for (let i = 0; i < 4; i++) drafts.push((await up(token).then((r) => (expect(r.status).toBe(200), r))).body.draftId);
      for (const d of drafts.slice(0, 2)) for (let i = 0; i < 2; i++) expect((await up(token, d)).status).toBe(200); // 4 + 4 = 8
      expect((await up(token, drafts[2])).status).toBe(200); // 9
      expect((await up(token, drafts[2])).status).toBe(200); // 10
      const eleventh = await up(token, drafts[3]);
      expect(eleventh.status).toBe(429);
      expect(eleventh.body.error.code).toBe('TOO_MANY_UPLOADS');
      // Storage holds one photo per draft at most (replaced photos are deleted), never the flood.
      expect(store.keys().length).toBeLessThanOrEqual(4);
    });

    it('bounds submit attempts per link: 20 per window, then 429', async () => {
      const { token } = await link();
      const missing = form({ draftId: '00000000-0000-4000-8000-000000000000', consentTextId: consentId });
      let last = 0;
      for (let i = 0; i < 20; i++) last = (await send(token, missing)).status;
      expect(last).toBe(404); // an unknown draft, every time
      const blocked = await send(token, missing);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('a flood on one link does not affect another link', async () => {
      const one = await link();
      const otherBooking = await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId: (await t.prisma.property.findFirstOrThrow()).id, checkIn: new Date(Date.now() + 20 * DAY), checkOut: new Date(Date.now() + 22 * DAY), source: 'DIRECT' } });
      const two = (await a.as.OWNER_MANAGER.post(`/api/bookings/${otherBooking.id}/checkin-links`, {}).expect(201)).body as { token: string };
      for (let i = 0; i < 21; i++) await send(one.token, form({ draftId: '00000000-0000-4000-8000-000000000000', consentTextId: consentId }));
      expect((await up(two.token)).status).toBe(200);
    });

    it('never accepts the token anywhere but the header (path, query, body, cookie, other headers)', async () => {
      const { token } = await link();
      const server = () => request(t.app.getHttpServer());
      const neutral = { code: 'LINK_UNAVAILABLE', message: 'This link is not available.' };
      const inQuery = await server().get(`/api/checkin?token=${token}`);
      expect(inQuery.status).toBe(400); // a token in the query string is refused outright, never read
      expect(JSON.stringify(inQuery.body)).not.toContain(token); // and never echoed
      expect((await server().get('/api/checkin').set('Authorization', `Bearer ${token}`)).body.error).toEqual(neutral);
      expect((await server().get('/api/checkin').set('Cookie', `token=${token}; checkin=${token}`)).body.error).toEqual(neutral);
      expect((await server().get(`/api/checkin/${token}`)).status).toBe(404); // no such route
      expect((await server().post('/api/checkin/submit').set(CSRF_HEADER, CSRF_HEADER_VALUE).send({ ...form(), token })).status).toBe(400); // unknown field, and not read
      expect((await server().get('/api/checkin').set(TOKEN, token)).status).toBe(200); // the header works
    });

    it('sets no cookie and no CORS headers on any guest route', async () => {
      const { token } = await link();
      const view = await request(t.app.getHttpServer()).get('/api/checkin').set(TOKEN, token).set('Origin', 'https://evil.test');
      expect(view.status).toBe(200);
      expect(view.headers['set-cookie']).toBeUndefined();
      expect(view.headers['access-control-allow-origin']).toBeUndefined();
      const preflight = await request(t.app.getHttpServer()).options('/api/checkin/submit').set('Origin', 'https://evil.test').set('Access-Control-Request-Method', 'POST');
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers every unusable link with identical status, body and cache headers', async () => {
      const live = await link();
      const revoked = await link();
      const rows = await t.prisma.checkInLink.findMany();
      const revokedRow = rows.find((r) => r.id !== rows[0].id) ?? rows[1];
      await a.as.OWNER_MANAGER.delete(`/api/checkin-links/${revokedRow.id}`).expect(204);
      const probe = async (token?: string) => {
        const res = await request(t.app.getHttpServer()).get('/api/checkin').set(...(token ? ([TOKEN, token] as [string, string]) : (['X-None', '1'] as [string, string])));
        const { requestId, ...body } = res.body;
        void requestId;
        return { status: res.status, body, cache: res.headers['cache-control'], robots: res.headers['x-robots-tag'], ref: res.headers['referrer-policy'], type: res.headers['content-type'] };
      };
      await request(t.app.getHttpServer()).get('/api/checkin').set(TOKEN, live.token).expect(200);
      const answers = [await probe(), await probe('A'.repeat(43)), await probe(revoked.token), await probe('short')];
      for (const answer of answers) expect(answer).toEqual(answers[0]);
      expect(answers[0].status).toBe(404);
    });

    it('never answers a malformed request with a server error', async () => {
      const { token } = await link();
      const server = () => request(t.app.getHttpServer());
      const json = (body: string) => server().post('/api/checkin/submit').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, token).set('Content-Type', 'application/json').send(body);
      const statuses = [
        (await json('{not json')).status,
        (await json('[]')).status,
        (await json('null')).status,
        (await json('"a string"')).status,
        (await json(JSON.stringify({ __proto__: { admin: true }, constructor: { prototype: { x: 1 } } }))).status,
        (await json(JSON.stringify({ draftId: { $ne: null }, consentTextId: ['x'], consent: 'true' }))).status,
        (await json(JSON.stringify({ ...form(), fullName: 'A'.repeat(200_000) }))).status, // over the JSON body limit
        (await server().post('/api/checkin/submit').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, token).set('Content-Type', 'text/plain').send('hello')).status,
        (await server().post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, token).set('Content-Type', 'multipart/form-data; boundary=x').send('--x\r\nbroken')).status,
        (await server().post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, token).attach('file', await photo(), 'a.jpg').attach('file', await photo(), 'b.jpg')).status, // two files
        (await server().post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, token).attach('other', await photo(), 'a.jpg')).status, // wrong field name
        (await server().post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, token).field('a', '1').field('b', '2').field('c', '3').field('d', '4').attach('file', await photo(), 'a.jpg')).status, // too many parts
      ];
      for (const status of statuses) expect(status).toBeGreaterThanOrEqual(400);
      for (const status of statuses) expect(status).toBeLessThan(500);
    });

    it('stores SQL-looking or script-looking text as inert data, and refuses markup', async () => {
      const { token } = await link();
      const draft = (await up(token)).body.draftId as string;
      const sql = "Robert'); DROP TABLE \"GuestCheckIn\";--";
      expect((await send(token, { ...form({ profession: sql }), draftId: draft, consentTextId: consentId })).status).toBe(200);
      expect((await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: draft } })).profession).toBe(sql);
      expect(await t.prisma.guestCheckIn.count()).toBe(1); // the table is still there

      const second = (await up(token)).body.draftId as string;
      for (const profession of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'a‮b', 'a\u0000b']) {
        expect((await send(token, { ...form({ profession }), draftId: second, consentTextId: consentId })).status).toBe(400);
      }
    });

    it('is CSRF-protected like every state-changing route', async () => {
      const { token } = await link();
      await request(t.app.getHttpServer()).post('/api/checkin/submit').set(TOKEN, token).send({}).expect(403);
    });
  });

  describe('per-IP throttling (real limits on)', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } });
      await resetDatabase(t.prisma, t.redis);
    });
    afterAll(async () => {
      await t.app.close();
    });

    it('caps token guessing on the view route at 60 a minute per address, with a clean 429', async () => {
      const server = t.app.getHttpServer();
      const statuses: number[] = [];
      for (let i = 0; i < 62; i++) statuses.push((await request(server).get('/api/checkin').set(TOKEN, `${'A'.repeat(42)}${i % 10}`)).status);
      expect(statuses.slice(0, 60).every((s) => s === 404)).toBe(true);
      expect(statuses.slice(60)).toEqual([429, 429]);
      const limited = await request(server).get('/api/checkin').set(TOKEN, 'x');
      expect(limited.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(limited.headers['cache-control']).toBe('no-store'); // even the rate limiter's answer
      expect(limited.headers['x-robots-tag']).toMatch(/noindex/);
    });

    it('caps uploads and submits at 10 a minute per address, before any image work is done', async () => {
      const server = t.app.getHttpServer();
      const junk = Buffer.from('not an image');
      const uploads: number[] = [];
      for (let i = 0; i < 12; i++) uploads.push((await request(server).post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, 'A'.repeat(43)).attach('file', junk, 'x.jpg')).status);
      expect(uploads.slice(10).every((s) => s === 429)).toBe(true);
      const submits: number[] = [];
      for (let i = 0; i < 12; i++) submits.push((await request(server).post('/api/checkin/submit').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN, 'A'.repeat(43)).send({})).status);
      expect(submits.slice(10).every((s) => s === 429)).toBe(true);
    });
  });
});
