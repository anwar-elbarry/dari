import request from 'supertest';
import sharp from 'sharp';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../common/csrf.guard';
import { MemoryObjectStore } from '../storage/memory-object-store';
import { OBJECT_STORE } from '../storage/object-store';
import { StorageService } from '../storage/storage.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { mapWorkerResponse, OcrClient } from './ocr.client';

requireDatabase();

const DAY = 86_400_000;
const TOKEN_HEADER = 'X-Checkin-Token';

const WORKER_OK = {
  status: 'ok',
  quality: { blurry: false, low_contrast: false },
  format: 'TD3',
  fields: { document_type: 'P', surname: 'ERIKSSON', given_names: 'ANNA MARIA', document_number: 'L898902C3', nationality: 'UTO', birth_date: '1974-08-12', expiry_date: '2012-04-15' },
  flagged: [],
  corrected: [],
  unverified: ['surname', 'given_names', 'nationality'],
  confidence: 1,
};

/** A photo with GPS-like EXIF, as a phone would send. */
const photo = (w = 1400, h = 900) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .withExif({ IFD0: { ImageDescription: 'GPS 31.6295,-7.9811', Copyright: 'SECRET-OWNER' } })
    .jpeg()
    .toBuffer();

const form = (over: Record<string, unknown> = {}) => ({
  docType: 'PASSPORT',
  fullName: 'Anna Maria Eriksson',
  nationality: 'UTO',
  docNumber: 'L898902C3',
  dob: '1974-08-12',
  docExpiryDate: '2030-04-15',
  declaredMoroccanNationality: false,
  entryStampNumber: 'CMN-2026-001',
  cityOfOrigin: 'Stockholm',
  nextDestination: 'Essaouira',
  profession: 'Engineer',
  consent: true,
  ...over,
});

describe('guest check-in (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let propertyId: string;
  let bookingId: string;
  let consentFr: string;
  let store: MemoryObjectStore;
  let storage: StorageService;

  beforeAll(async () => {
    t = await createTestApp();
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
    storage = t.app.get(StorageService);
  });
  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    for (const key of store.keys()) await store.delete(key);
    jest.restoreAllMocks();
    jest.spyOn(t.app.get(OcrClient), 'extract').mockResolvedValue(mapWorkerResponse(WORKER_OK));

    a = await seedAccount(t, 'Alpha');
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Owner', residency: 'RESIDENT' } });
    propertyId = (await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad Yasmine', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } })).id;
    bookingId = (await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(Date.now() + 10 * DAY), checkOut: new Date(Date.now() + 13 * DAY), source: 'DIRECT', partySize: 2 } })).id;
    for (const [key, value] of [['retention.id_images_days', { days: 30 }], ['checkin.link_grace_hours', { hours: 48 }]] as const) {
      await t.prisma.ruleConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    const approved = new Date(Date.now() - DAY);
    consentFr = (await t.prisma.consentText.create({ data: { version: 'v1', locale: 'fr', body: 'Je consens.', approvedBy: 'counsel', approvedAt: approved } })).id;
    await t.prisma.consentText.create({ data: { version: 'v1', locale: 'en', body: 'I consent.', approvedBy: 'counsel', approvedAt: approved } });
  });

  // ---- helpers
  const newLink = async (body: object = {}, who: 'OWNER_MANAGER' | 'STAFF' = 'OWNER_MANAGER', booking = bookingId) => {
    const res = await a.as[who].post(`/api/bookings/${booking}/checkin-links`, body).expect(201);
    return res.body as { id: string; token: string; url: string; expiresAt: string; maxGuests: number; guestsSubmitted: number };
  };
  const guestGet = (token: string | undefined, path = '') => {
    const req = request(t.app.getHttpServer()).get(`/api/checkin${path}`);
    return token === undefined ? req : req.set(TOKEN_HEADER, token);
  };
  const guestPost = (token: string, path: string, body: object) => request(t.app.getHttpServer()).post(`/api/checkin${path}`).set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN_HEADER, token).send(body);
  const upload = async (token: string, opts: { draftId?: string; buffer?: Buffer; filename?: string; type?: string } = {}) => {
    let req = request(t.app.getHttpServer()).post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN_HEADER, token);
    if (opts.draftId) req = req.field('draftId', opts.draftId);
    return req.attach('file', opts.buffer ?? (await photo()), { filename: opts.filename ?? 'passport.jpg', contentType: opts.type ?? 'image/jpeg' });
  };
  /** Uploads a photo and returns the draft id. */
  const draftFor = async (token: string) => (await upload(token).then((r) => (expect(r.status).toBe(200), r))).body.draftId as string;
  const submit = (token: string, draftId: string, over: Record<string, unknown> = {}) => guestPost(token, '/submit', { ...form(), draftId, consentTextId: consentFr, ...over });
  const neutral = (res: request.Response) => ({ status: res.status, error: res.body.error });

  // ==========================================================================================
  describe('links (team)', () => {
    it('creates a link: the token is returned once, only its hash is stored, and the URL keeps it in the fragment', async () => {
      const link = await newLink();
      expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(link.url).toBe(`http://localhost:3000/checkin#token=${link.token}`);
      expect(new URL(link.url).search).toBe(''); // nothing a server or a link-preview bot would receive

      const row = await t.prisma.checkInLink.findUniqueOrThrow({ where: { id: link.id } });
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.tokenHash).not.toContain(link.token);
      expect(row.maxGuests).toBe(2); // the booking's party size
      // checkout + 48 h grace, from RuleConfig
      const checkOut = (await t.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).checkOut;
      expect(new Date(row.expiresAt).getTime()).toBe(checkOut.getTime() + 48 * 3_600_000);
      expect((await t.prisma.auditLog.findMany({ where: { action: 'checkin.link.created' } })).map((r) => [r.actorId, r.resourceId])).toEqual([[a.users.OWNER_MANAGER.id, link.id]]);
    });

    it('never returns the token or hash again when listing', async () => {
      const link = await newLink();
      const res = await a.as.STAFF.get(`/api/bookings/${bookingId}/checkin-links`).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ id: link.id, status: 'ACTIVE', guestsSubmitted: 0, maxGuests: 2 });
      expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${link.token}|tokenHash|token`));
    });

    it('lets Staff send links', async () => {
      const link = await newLink({}, 'STAFF');
      expect((await t.prisma.checkInLink.findUniqueOrThrow({ where: { id: link.id } })).createdBy).toBe(a.users.STAFF.id);
    });

    it('accepts a party size between 1 and 10 only', async () => {
      await a.as.OWNER_MANAGER.post(`/api/bookings/${bookingId}/checkin-links`, { maxGuests: 0 }).expect(400);
      await a.as.OWNER_MANAGER.post(`/api/bookings/${bookingId}/checkin-links`, { maxGuests: 11 }).expect(400);
      await a.as.OWNER_MANAGER.post(`/api/bookings/${bookingId}/checkin-links`, { maxGuests: 3, role: 'x' }).expect(400);
      expect((await newLink({ maxGuests: 3 })).maxGuests).toBe(3);
    });

    it('refuses links for cancelled bookings, owner blocks and stays long past', async () => {
      const mk = (data: object) => t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(Date.now() + 20 * DAY), checkOut: new Date(Date.now() + 22 * DAY), source: 'DIRECT', ...data } });
      const cancelled = await mk({ status: 'CANCELLED' });
      const block = await mk({ classification: 'OWNER_BLOCK' });
      const past = await mk({ checkIn: new Date(Date.now() - 30 * DAY), checkOut: new Date(Date.now() - 27 * DAY) });
      for (const b of [cancelled, block]) {
        expect((await a.as.OWNER_MANAGER.post(`/api/bookings/${b.id}/checkin-links`, {}).expect(409)).body.error.code).toBe('BOOKING_NOT_ELIGIBLE');
      }
      expect((await a.as.OWNER_MANAGER.post(`/api/bookings/${past.id}/checkin-links`, {}).expect(409)).body.error.code).toBe('LINK_WINDOW_CLOSED');
    });

    it('revokes (idempotently, with one audit row) and the link stops working at once', async () => {
      const link = await newLink();
      await guestGet(link.token).expect(200);
      await a.as.STAFF.delete(`/api/checkin-links/${link.id}`).expect(204);
      await a.as.STAFF.delete(`/api/checkin-links/${link.id}`).expect(204);
      expect((await guestGet(link.token)).status).toBe(404);
      expect(await t.prisma.auditLog.count({ where: { action: 'checkin.link.revoked' } })).toBe(1);
      expect((await a.as.OWNER_MANAGER.get(`/api/bookings/${bookingId}/checkin-links`)).body[0].status).toBe('REVOKED');
    });

    it('resends: a fresh token replaces the old one, which stops working', async () => {
      const old = await newLink();
      const res = await a.as.OWNER_MANAGER.post(`/api/checkin-links/${old.id}/resend`).expect(201);
      expect(res.body.token).not.toBe(old.token);
      expect((await guestGet(old.token)).status).toBe(404);
      expect((await guestGet(res.body.token)).status).toBe(200);
      const actions = (await t.prisma.auditLog.findMany({ where: { action: { startsWith: 'checkin.' } }, orderBy: { createdAt: 'asc' } })).map((r) => r.action);
      expect(actions).toEqual(['checkin.link.created', 'checkin.link.revoked', 'checkin.link.created']);
    });

    it('counts guests who already checked in against the party', async () => {
      const first = await newLink({ maxGuests: 1 });
      await submit(first.token, await draftFor(first.token)).expect(200);
      expect((await a.as.OWNER_MANAGER.post(`/api/bookings/${bookingId}/checkin-links`, { maxGuests: 1 }).expect(409)).body.error.code).toBe('PARTY_COMPLETE');
      const more = await newLink({ maxGuests: 2 }); // room for one more guest
      expect(more.guestsSubmitted).toBe(1);
    });
  });

  // ==========================================================================================
  describe('public view', () => {
    it('shows the property name, the dates and the consent text: nothing else', async () => {
      const link = await newLink();
      const res = await guestGet(link.token).expect(200);
      expect(res.body).toMatchObject({
        property: { name: 'Riad Yasmine' },
        guests: { submitted: 0, max: 2, remaining: 2 },
        consent: { id: consentFr, version: 'v1', locale: 'fr', body: 'Je consens.' },
        requiredFields: ['entryStampNumber', 'cityOfOrigin', 'nextDestination', 'profession'],
      });
      expect(res.body.stay.checkIn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const text = JSON.stringify(res.body);
      for (const secret of [a.accountId, bookingId, propertyId, link.id, 'tokenHash', 'Owner', 'address', 'Marrakech']) expect(text).not.toContain(secret);
    });

    it('is never cached or indexed and sends no referrer', async () => {
      const link = await newLink();
      const res = await guestGet(link.token).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toMatch(/noindex/);
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('answers in English on request and refuses other languages', async () => {
      const link = await newLink();
      expect((await guestGet(link.token, '?lang=en').expect(200)).body.consent.body).toBe('I consent.');
      await guestGet(link.token, '?lang=de').expect(400);
    });

    it('gives one identical answer for unknown, malformed, missing, expired, revoked, full and cancelled links', async () => {
      const live = await newLink({ maxGuests: 1 });
      const expired = await newLink();
      await t.prisma.checkInLink.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const revoked = await newLink();
      await a.as.OWNER_MANAGER.delete(`/api/checkin-links/${revoked.id}`).expect(204);
      const full = await newLink();
      await t.prisma.checkInLink.update({ where: { id: full.id }, data: { guestsSubmitted: 2 } });
      const cancelledBooking = await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(Date.now() + 20 * DAY), checkOut: new Date(Date.now() + 22 * DAY), source: 'DIRECT' } });
      const cancelled = await newLink({}, 'OWNER_MANAGER', cancelledBooking.id);
      await t.prisma.booking.update({ where: { id: cancelledBooking.id }, data: { status: 'CANCELLED' } });
      await guestGet(live.token).expect(200);

      const answers = await Promise.all(
        [undefined, '', 'x', 'A'.repeat(43), 'A'.repeat(200), '<script>', expired.token, revoked.token, full.token, cancelled.token].map(async (token) => neutral(await guestGet(token))),
      );
      for (const answer of answers) expect(answer).toEqual({ status: 404, error: { code: 'LINK_UNAVAILABLE', message: 'This link is not available.' } });
    });

    it('refuses to start when no consent text is approved', async () => {
      const link = await newLink();
      await t.prisma.consentText.updateMany({ data: { approvedAt: null } });
      const res = await guestGet(link.token).expect(503);
      expect(res.body.error.code).toBe('CHECKIN_UNAVAILABLE');
    });

    it('answers 404 on every guest route when the feature flag is off', async () => {
      const off = await createTestApp({ env: { GUEST_CHECKIN_ENABLED: 'false' } });
      try {
        const server = off.app.getHttpServer();
        const dead = [
          () => request(server).get('/api/checkin').set(TOKEN_HEADER, 'A'.repeat(43)),
          () => request(server).post('/api/checkin/submit').set(CSRF_HEADER, CSRF_HEADER_VALUE).send({}),
          () => request(server).post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE),
        ];
        for (const call of dead) {
          const res = await call();
          expect({ status: res.status, code: res.body.error.code }).toEqual({ status: 404, code: 'NOT_FOUND' });
        }
      } finally {
        await off.app.close();
      }
    });
  });

  // ==========================================================================================
  describe('document upload', () => {
    it('stores an encrypted, EXIF-free JPEG and returns suggestions, never the image', async () => {
      const link = await newLink();
      const res = await upload(link.token).then((r) => (expect(r.status).toBe(200), r));

      expect(res.body.draftId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.uploadsLeft).toBe(2);
      expect(res.body.ocr).toMatchObject({ status: 'ok', suggestion: { fullName: 'ANNA MARIA ERIKSSON', docNumber: 'L898902C3', docType: 'PASSPORT' }, flagged: [] });
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/docImageId|storedObject|key|url|jpeg|base64/i);

      // What the bucket holds is ciphertext.
      const [objectKey] = store.keys();
      expect(store.raw(objectKey)![1]).not.toBe(0xff); // not a JPEG (version byte then random iv)
      expect(store.raw(objectKey)!.includes(Buffer.from('JFIF'))).toBe(false);
      // What it decrypts to is a fresh JPEG with no metadata.
      const draft = await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: res.body.draftId } });
      const read = await storage.read(a.accountId, draft.docImageId!, { actorId: null, action: 'guest.document.read', resourceType: 'GuestCheckIn', resourceId: draft.id });
      const meta = await sharp(read.bytes).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
      expect(read.bytes.includes(Buffer.from('SECRET-OWNER'))).toBe(false);
      expect(read.bytes.includes(Buffer.from('GPS'))).toBe(false);
    });

    it('sets the retention date from RuleConfig (checkout + days)', async () => {
      await t.prisma.ruleConfig.update({ where: { key: 'retention.id_images_days' }, data: { value: { days: 14 } } });
      const link = await newLink();
      const draftId = await draftFor(link.token);
      const draft = await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: draftId }, include: { docImage: true, booking: true } });
      expect(draft.docImage!.expiresAt!.getTime()).toBe(draft.booking.checkOut.getTime() + 14 * DAY);
    });

    it('records the OCR outcome as field names and hashes only (no values)', async () => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      const stored = (await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: draftId } })).ocrFieldsFlagged as { status: string; suggestedHashes: Record<string, string> };
      expect(stored.status).toBe('ok');
      expect(Object.keys(stored.suggestedHashes)).toEqual(expect.arrayContaining(['fullName', 'docNumber', 'dob']));
      expect(JSON.stringify(stored)).not.toMatch(/ERIKSSON|L898902C3|1974/);
    });

    it('still works, with manual entry, when the OCR worker is down', async () => {
      jest.spyOn(t.app.get(OcrClient), 'extract').mockResolvedValue(mapWorkerResponse(null));
      const link = await newLink();
      const res = await upload(link.token);
      expect(res.status).toBe(200);
      expect(res.body.ocr).toMatchObject({ status: 'unavailable', suggestion: {} });
      await submit(link.token, res.body.draftId, { fullName: 'Typed By Hand' }).expect(200);
    });

    it('refuses what is not a usable photo, and stores nothing', async () => {
      const link = await newLink();
      const cases: [string, Buffer, number, string][] = [
        ['a PDF renamed .jpg', Buffer.from('%PDF-1.7 hello'), 422, 'IMAGE_INVALID'],
        ['an SVG with a script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 422, 'IMAGE_INVALID'],
        ['a JPEG header with junk', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('x'.repeat(500))]), 422, 'IMAGE_INVALID'],
        ['a photo that is too small', await photo(200, 150), 422, 'IMAGE_TOO_SMALL'],
        ['a file over 8 MB', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8 * 1024 * 1024 + 10)]), 413, 'TOO_LARGE'],
      ];
      for (const [label, buffer, status, code] of cases) {
        const res = await upload(link.token, { buffer });
        // The upload limit is enforced by the multipart parser (PAYLOAD_TOO_LARGE) or the sanitiser (IMAGE_TOO_LARGE).
        const got = code === 'TOO_LARGE' ? (['IMAGE_TOO_LARGE', 'PAYLOAD_TOO_LARGE'].includes(res.body.error?.code) ? 'TOO_LARGE' : res.body.error?.code) : res.body.error?.code;
        expect({ label, status: res.status, code: got }).toEqual({ label, status, code });
      }
      expect(store.keys()).toHaveLength(0);
      expect(await t.prisma.storedObject.count()).toBe(0);
    });

    it('drops a payload appended to a valid image', async () => {
      const link = await newLink();
      const polyglot = Buffer.concat([await photo(), Buffer.from('<?php system($_GET["c"]); ?>PK\x03\x04')]);
      const res = await upload(link.token, { buffer: polyglot });
      expect(res.status).toBe(200);
      const draft = await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: res.body.draftId } });
      const bytes = (await storage.read(a.accountId, draft.docImageId!, { actorId: null, action: 'guest.document.read', resourceType: 'GuestCheckIn', resourceId: draft.id })).bytes;
      expect(bytes.includes(Buffer.from('<?php'))).toBe(false);
    });

    it('requires a file', async () => {
      const link = await newLink();
      const res = await request(t.app.getHttpServer()).post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(TOKEN_HEADER, link.token).field('draftId', '');
      expect([400, 422]).toContain(res.status);
    });

    it('allows three photos per guest: a new photo replaces the last one, and the 4th is refused', async () => {
      const link = await newLink();
      const first = await upload(link.token);
      const draftId = first.body.draftId as string;
      await upload(link.token, { draftId }).then((r) => expect(r.body.uploadsLeft).toBe(1));
      await upload(link.token, { draftId }).then((r) => expect(r.body.uploadsLeft).toBe(0));
      const fourth = await upload(link.token, { draftId });
      expect(fourth.status).toBe(429);
      expect(fourth.body.error.code).toBe('TOO_MANY_IMAGES');

      // Only the latest photo is kept; the replaced ones were deleted (and their keys shredded).
      expect(store.keys()).toHaveLength(1);
      const rows = await t.prisma.storedObject.findMany({ orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => r.deletedAt !== null)).toEqual([true, true, false]);
      expect(rows.filter((r) => r.deletedAt).every((r) => r.wrappedKey === '')).toBe(true);
    });

    it('bounds the unfinished drafts a link can hold', async () => {
      const link = await newLink(); // 2 guests: 4 open drafts at most
      for (let i = 0; i < 4; i++) await upload(link.token).then((r) => expect(r.status).toBe(200));
      const res = await upload(link.token);
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('TOO_MANY_DRAFTS');
    });

    it("refuses another link's draft", async () => {
      const one = await newLink();
      const draftId = await draftFor(one.token);
      const otherBooking = await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(Date.now() + 20 * DAY), checkOut: new Date(Date.now() + 22 * DAY), source: 'DIRECT' } });
      const two = await newLink({}, 'OWNER_MANAGER', otherBooking.id);
      const res = await upload(two.token, { draftId });
      expect(res.status).toBe(404);
      expect((await submit(two.token, draftId)).status).toBe(404);
    });

    it('needs the CSRF header and a token', async () => {
      const link = await newLink();
      const body = await photo();
      await request(t.app.getHttpServer()).post('/api/checkin/document').set(TOKEN_HEADER, link.token).attach('file', body, 'p.jpg').expect(403);
      expect((await request(t.app.getHttpServer()).post('/api/checkin/document').set(CSRF_HEADER, CSRF_HEADER_VALUE).attach('file', body, 'p.jpg')).status).toBe(404);
    });
  });

  // ==========================================================================================
  describe('submit', () => {
    it('records the guest, the consent, the link count and the audit row; returns nothing but the outcome', async () => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      const res = await submit(link.token, draftId, { docNumber: 'L898902C4' }).expect(200); // the guest corrected the number
      expect(res.body).toEqual({ status: 'submitted', guestIndex: 1, remaining: 1, canAddGuest: true });

      const guest = await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: draftId } });
      expect(guest).toMatchObject({
        status: 'SUBMITTED',
        guestIndex: 1,
        docType: 'PASSPORT',
        fullName: 'Anna Maria Eriksson',
        nationality: 'UTO',
        docNumber: 'L898902C4',
        declaredMoroccanNationality: false,
        entryStampNumber: 'CMN-2026-001',
        cityOfOrigin: 'Stockholm',
        nextDestination: 'Essaouira',
        profession: 'Engineer',
        consentTextId: consentFr,
      });
      expect(guest.dob!.toISOString().slice(0, 10)).toBe('1974-08-12');
      expect(guest.consentAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
      expect(guest.submittedAt).not.toBeNull();
      // Field names only, never values.
      expect(guest.ocrFieldsFlagged).toEqual({ status: 'ok', flagged: [], edited: ['docNumber', 'docExpiryDate'] }); // the name was not edited
      expect((await t.prisma.checkInLink.findUniqueOrThrow({ where: { id: link.id } })).guestsSubmitted).toBe(1);
      expect((await t.prisma.auditLog.findMany({ where: { action: 'checkin.submitted' } })).map((r) => [r.actorId, r.resourceId, r.accountId])).toEqual([[null, draftId, a.accountId]]);
    });

    it.each(['entryStampNumber', 'cityOfOrigin', 'nextDestination', 'profession'])('refuses a missing, empty or blank %s, server-side', async (field) => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      const base = { ...form(), draftId, consentTextId: consentFr };
      const missing: Record<string, unknown> = { ...base };
      delete missing[field];
      for (const body of [missing, { ...base, [field]: '' }, { ...base, [field]: '   ' }, { ...base, [field]: null }]) {
        const res = await guestPost(link.token, '/submit', body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
      }
      expect((await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: draftId } })).status).toBe('PENDING');
      expect((await t.prisma.checkInLink.findUniqueOrThrow({ where: { id: link.id } })).guestsSubmitted).toBe(0);
    });

    it('refuses a missing identity field, a skipped nationality question and missing or false consent', async () => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      const base = { ...form(), draftId, consentTextId: consentFr };
      const fields = ['docType', 'fullName', 'nationality', 'docNumber', 'dob', 'declaredMoroccanNationality', 'consent', 'consentTextId', 'draftId'];
      for (const field of fields) {
        const body: Record<string, unknown> = { ...base };
        delete body[field];
        expect({ field, status: (await guestPost(link.token, '/submit', body)).status }).toEqual({ field, status: 400 });
      }
      expect((await guestPost(link.token, '/submit', { ...base, consent: false })).status).toBe(400);
      expect((await guestPost(link.token, '/submit', { ...base, consent: 'true' })).status).toBe(400);
    });

    it('rejects unknown fields, bad formats and control or bidi characters', async () => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      const bad: Record<string, unknown>[] = [
        { status: 'VERIFIED' },
        { fullName: 'A' },
        { fullName: 'Anna<script>' },
        { fullName: 'Anna‮evil' },
        { fullName: 'Anna123' },
        { nationality: 'FR' },
        { nationality: 'France' },
        { docNumber: '<>' },
        { docNumber: 'AB' },
        { cityOfOrigin: 'Paris\u0000' },
        { profession: 'x'.repeat(81) },
        { entryStampNumber: 'a'.repeat(41) },
        { dob: '1974-8-12' },
        { dob: 'not a date' },
        { docType: 'DRIVING_LICENCE' },
        { declaredMoroccanNationality: 'no' },
      ];
      for (const over of bad) expect({ over, status: (await submit(link.token, draftId, over)).status }).toEqual({ over, status: 400 });
      expect((await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: draftId } })).status).toBe('PENDING');
    });

    it('checks that the dates are real and plausible', async () => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      for (const over of [{ dob: '1974-02-30' }, { dob: '2999-01-01' }, { dob: '1800-01-01' }, { docExpiryDate: '2099-01-01' }, { docExpiryDate: '1980-01-01' }]) {
        const res = await submit(link.token, draftId, over);
        expect({ over, status: res.status, code: res.body.error?.code }).toEqual({ over, status: 422, code: 'VALIDATION_FAILED' });
      }
    });

    it('needs an approved consent text and a photo', async () => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      const draftText = await t.prisma.consentText.create({ data: { version: 'v2', locale: 'fr', body: 'brouillon' } });
      for (const id of [draftText.id, '00000000-0000-4000-8000-000000000000']) {
        const res = await submit(link.token, draftId, { consentTextId: id });
        expect({ status: res.status, code: res.body.error.code }).toEqual({ status: 422, code: 'CONSENT_INVALID' });
      }
      // A draft that has no photo cannot be submitted.
      const bare = await t.prisma.guestCheckIn.create({ data: { accountId: a.accountId, bookingId, propertyId, linkId: link.id } });
      const res = await submit(link.token, bare.id);
      expect({ status: res.status, code: res.body.error.code }).toEqual({ status: 409, code: 'DOCUMENT_REQUIRED' });
    });

    it('is single use per guest: submitting the same draft twice counts once', async () => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      await submit(link.token, draftId).expect(200);
      expect((await submit(link.token, draftId)).status).toBe(404);
      expect((await t.prisma.checkInLink.findUniqueOrThrow({ where: { id: link.id } })).guestsSubmitted).toBe(1);
      expect(await t.prisma.guestCheckIn.count({ where: { status: 'SUBMITTED' } })).toBe(1);
    });

    it('takes the guests in turn and closes the link when the party is complete', async () => {
      const link = await newLink({ maxGuests: 2 });
      const one = await submit(link.token, await draftFor(link.token), { fullName: 'First Guest' }).expect(200);
      expect(one.body).toMatchObject({ guestIndex: 1, remaining: 1, canAddGuest: true });
      const view = await guestGet(link.token).expect(200);
      expect(view.body.guests).toEqual({ submitted: 1, max: 2, remaining: 1 });
      expect(JSON.stringify(view.body)).not.toContain('First Guest'); // never another guest's data

      const two = await submit(link.token, await draftFor(link.token), { fullName: 'Second Guest' }).expect(200);
      expect(two.body).toMatchObject({ guestIndex: 2, remaining: 0, canAddGuest: false });
      expect(neutral(await guestGet(link.token))).toMatchObject({ status: 404, error: { code: 'LINK_UNAVAILABLE' } });
      expect((await upload(link.token)).status).toBe(404);
    });

    it('cannot exceed the party even with parallel submissions', async () => {
      const link = await newLink({ maxGuests: 1 });
      // Open two drafts while there is still room, then submit both at once.
      const [d1, d2] = [await draftFor(link.token), await draftFor(link.token)];
      const results = await Promise.all([submit(link.token, d1), submit(link.token, d2)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect((await t.prisma.checkInLink.findUniqueOrThrow({ where: { id: link.id } })).guestsSubmitted).toBe(1);
      expect(await t.prisma.guestCheckIn.count({ where: { status: 'SUBMITTED' } })).toBe(1);
    });

    it('gives distinct guest numbers when two guests submit at the same moment', async () => {
      const link = await newLink({ maxGuests: 2 });
      const [d1, d2] = [await draftFor(link.token), await draftFor(link.token)];
      const results = await Promise.all([submit(link.token, d1), submit(link.token, d2)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(results.map((r) => r.body.guestIndex).sort()).toEqual([1, 2]);
    });

    it('fails, without counting, if the link was revoked after the photo', async () => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      await a.as.OWNER_MANAGER.delete(`/api/checkin-links/${link.id}`).expect(204);
      expect((await submit(link.token, draftId)).status).toBe(404);
      expect((await t.prisma.checkInLink.findUniqueOrThrow({ where: { id: link.id } })).guestsSubmitted).toBe(0);
      expect((await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: draftId } })).status).toBe('PENDING');
    });

    it('never puts anything but the outcome in the response', async () => {
      const link = await newLink();
      const res = await submit(link.token, await draftFor(link.token)).expect(200);
      const text = JSON.stringify(res.body);
      for (const secret of ['Eriksson', 'L898902C3', 'Stockholm', a.accountId, bookingId, link.id]) expect(text).not.toContain(secret);
    });
  });

  // ==========================================================================================
  describe('the team sees guests', () => {
    async function submitted(over: Record<string, unknown> = {}) {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      await submit(link.token, draftId, over).expect(200);
      return { link, guestId: draftId };
    }

    it('shows Staff the status only, and Owner/Manager the fields', async () => {
      const { guestId } = await submitted();
      const staff = (await a.as.STAFF.get(`/api/guests/${guestId}`).expect(200)).body;
      expect(staff).toMatchObject({ id: guestId, status: 'SUBMITTED', guestIndex: 1, hasDocument: true, hasFiche: false });
      expect(staff.fields).toBeUndefined();
      expect(JSON.stringify(staff)).not.toMatch(/Eriksson|L898902C3|Stockholm|1974/);

      const manager = (await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}`).expect(200)).body;
      expect(manager.fields).toMatchObject({ fullName: 'Anna Maria Eriksson', docNumber: 'L898902C3', dob: '1974-08-12', profession: 'Engineer', entryStampNumber: 'CMN-2026-001' });
      expect(manager.consent.textId).toBe(consentFr);
      await a.as.ACCOUNTANT.get(`/api/guests/${guestId}`).expect(403);
    });

    it("hides a guest's unfinished draft", async () => {
      const link = await newLink();
      const draftId = await draftFor(link.token);
      await a.as.OWNER_MANAGER.get(`/api/guests/${draftId}`).expect(404);
    });

    it('serves the image only to Owner/Manager, decrypted, no-store, and audits every read', async () => {
      const { guestId } = await submitted();
      const first = await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}/document`).buffer(true).parse(binary).expect(200);
      expect(first.headers['content-type']).toBe('image/jpeg');
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.headers['x-robots-tag']).toMatch(/noindex/);
      expect((await sharp(first.body).metadata()).format).toBe('jpeg');

      await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}/document`).buffer(true).parse(binary).expect(200);
      const reads = await t.prisma.auditLog.findMany({ where: { action: 'guest.document.read' } });
      expect(reads).toHaveLength(2); // every read
      expect(reads.every((r) => r.actorId === a.users.OWNER_MANAGER.id && r.resourceType === 'GuestCheckIn' && r.resourceId === guestId && r.accountId === a.accountId)).toBe(true);

      // Refused roles read nothing and leave no read on record.
      await a.as.STAFF.get(`/api/guests/${guestId}/document`).expect(403);
      await a.as.ACCOUNTANT.get(`/api/guests/${guestId}/document`).expect(403);
      await a.as.ANON.get(`/api/guests/${guestId}/document`).expect(401);
      expect(await t.prisma.auditLog.count({ where: { action: 'guest.document.read' } })).toBe(2);
    });

    it('never links to the image: no URL appears in any guest or arrival response', async () => {
      const { guestId } = await submitted();
      const bodies = [
        (await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}`)).body,
        (await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/arrivals`)).body,
        (await a.as.STAFF.get(`/api/properties/${propertyId}/arrivals`)).body,
      ];
      for (const body of bodies) expect(JSON.stringify(body)).not.toMatch(/https?:|\.jpg|\/document|docImage|s3|amazonaws|signature/i);
    });

    it('answers 404 for the image once it has been purged', async () => {
      const { guestId } = await submitted();
      const guest = await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: guestId } });
      await storage.delete(a.accountId, guest.docImageId!, { actorId: null, action: 'storage.object.deleted', resourceType: 'GuestCheckIn', resourceId: guestId });
      await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}/document`).expect(404);
      expect((await a.as.STAFF.get(`/api/guests/${guestId}`)).body.hasDocument).toBe(false);
      expect((await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}`)).body.fields.fullName).toBe('Anna Maria Eriksson'); // the structured record stays
    });

    it('lets Owner/Manager correct fields and mark a guest verified, auditing without values', async () => {
      const { guestId } = await submitted();
      await a.as.STAFF.patch(`/api/guests/${guestId}`, { profession: 'x' }).expect(403);
      const res = await a.as.OWNER_MANAGER.patch(`/api/guests/${guestId}`, { docNumber: 'L898902C5', dob: '1974-08-13', verified: true }).expect(200);
      expect(res.body.status).toBe('VERIFIED');
      expect(res.body.fields).toMatchObject({ docNumber: 'L898902C5', dob: '1974-08-13' });
      const audit = await t.prisma.auditLog.findMany({ where: { action: 'guest.updated' } });
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toMatch(/L898902C5|1974/);
      await a.as.OWNER_MANAGER.patch(`/api/guests/${guestId}`, { dob: '2999-01-01' }).expect(422);
      await a.as.OWNER_MANAGER.patch(`/api/guests/${guestId}`, { fullName: 'Bad<name>' }).expect(400);
      await a.as.OWNER_MANAGER.patch(`/api/guests/${guestId}`, { status: 'SUBMITTED' }).expect(400);
    });

    it('lists arrivals with check-in status; Staff see no names', async () => {
      const arrivals = async (who: 'OWNER_MANAGER' | 'STAFF') => (await a.as[who].get(`/api/properties/${propertyId}/arrivals`).expect(200)).body as { checkinStatus: string; guests: { fullName?: string }[]; link: { status: string } | null }[];
      expect((await arrivals('OWNER_MANAGER'))[0]).toMatchObject({ checkinStatus: 'NONE', guests: [], link: null });

      const link = await newLink({ maxGuests: 2 });
      expect((await arrivals('OWNER_MANAGER'))[0]).toMatchObject({ checkinStatus: 'LINK_SENT', link: { status: 'ACTIVE' } });

      await submit(link.token, await draftFor(link.token)).expect(200);
      expect((await arrivals('OWNER_MANAGER'))[0]).toMatchObject({ checkinStatus: 'PARTIAL' });
      const staffView = (await arrivals('STAFF'))[0];
      expect(staffView.guests[0].fullName).toBeUndefined();
      expect((await arrivals('OWNER_MANAGER'))[0].guests[0].fullName).toBe('Anna Maria Eriksson');

      await submit(link.token, await draftFor(link.token), { fullName: 'Second Guest' }).expect(200);
      expect((await arrivals('OWNER_MANAGER'))[0]).toMatchObject({ checkinStatus: 'COMPLETE' });
    });

    it('filters arrivals by window and excludes cancelled stays and blocks', async () => {
      await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(Date.now() + 5 * DAY), checkOut: new Date(Date.now() + 6 * DAY), source: 'DIRECT', status: 'CANCELLED' } });
      await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(Date.now() + 5 * DAY), checkOut: new Date(Date.now() + 6 * DAY), source: 'DIRECT', classification: 'OWNER_BLOCK' } });
      await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(Date.now() - 20 * DAY), checkOut: new Date(Date.now() - 17 * DAY), source: 'DIRECT' } });
      const far = await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(Date.now() + 200 * DAY), checkOut: new Date(Date.now() + 203 * DAY), source: 'DIRECT' } });
      const ids = async (q = '') => ((await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/arrivals${q}`).expect(200)).body as { bookingId: string }[]).map((b) => b.bookingId);
      expect(await ids()).toEqual([bookingId]);
      expect(await ids('?days=365')).toEqual([bookingId, far.id]);
      await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/arrivals?days=0`).expect(400);
      await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/arrivals?days=abc`).expect(400);
    });
  });
});

/** supertest parser that keeps binary bodies as a Buffer. */
function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
