import request from 'supertest';
import { hashToken, randomToken } from '../auth/tokens';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../common/csrf.guard';
import { PdfRenderer } from '../checkin/pdf-renderer';
import { MemoryObjectStore } from '../storage/memory-object-store';
import { OBJECT_STORE } from '../storage/object-store';
import { StorageService } from '../storage/storage.service';
import { createTestApp, PASSWORD, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { LINK_VIEWS_PER_WINDOW } from './share.service';

requireDatabase();

/** The public share route is on the internet with only a link as credential: what can someone do with it? */
const DAY = 86_400_000;
const HEADER = 'X-Share-Token';
const PDF = Buffer.from('%PDF-1.4 fiche stub');

function binary(res: import('supertest').Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('public share route under abuse (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let store: MemoryObjectStore;
  let guestId: string;
  let bookingId: string;

  beforeAll(async () => {
    t = await createTestApp();
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
  });
  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(t.app.get(PdfRenderer), 'render').mockResolvedValue(Buffer.from('%PDF-1.4 register stub'));
    await resetDatabase(t.prisma, t.redis);
    for (const key of store.keys()) await store.delete(key);
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    const accountId = a.accountId;
    const owner = await t.prisma.propertyOwner.create({ data: { accountId, name: 'Owner', residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({ data: { accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } });
    const booking = await t.prisma.booking.create({ data: { accountId, propertyId: property.id, checkIn: new Date(Date.now() + 2 * DAY), checkOut: new Date(Date.now() + 4 * DAY), source: 'DIRECT' } });
    bookingId = booking.id;
    const link = await t.prisma.checkInLink.create({ data: { accountId, bookingId, tokenHash: `h-${Math.random()}`, expiresAt: new Date(Date.now() + DAY), createdBy: 'u', maxGuests: 1 } });
    const guest = await t.prisma.guestCheckIn.create({
      data: {
        accountId, bookingId, propertyId: property.id, linkId: link.id, guestIndex: 1, status: 'VERIFIED', docType: 'PASSPORT', fullName: 'Anna Eriksson', nationality: 'SWE',
        docNumber: 'L898902C3', dob: new Date('1974-08-12'), entryStampNumber: 'S1', cityOfOrigin: 'Stockholm', nextDestination: 'Fès', profession: 'Engineer', submittedAt: new Date(),
      },
    });
    guestId = guest.id;
    const pdf = await t.app.get(StorageService).put(accountId, 'FICHE_PDF', PDF);
    await t.prisma.ficheDePolice.create({ data: { accountId, guestCheckInId: guest.id, pdfObjectId: pdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64) } });
  });

  const share = async () =>
    (await a.as.OWNER_MANAGER.post('/api/shares', { resourceType: 'FICHE_DE_POLICE', guestId, expiresInHours: 24, recipientLabel: 'Police' }).expect(201)).body as { id: string; token: string };
  const server = () => request(t.app.getHttpServer());
  const open = (token: string) => server().get('/api/share').set(HEADER, token).buffer(true).parse(binary);
  const recorded = async () => ({
    accesses: await t.prisma.shareAccess.count(),
    audits: await t.prisma.auditLog.count({ where: { action: 'share.accessed' } }),
    views: (await t.prisma.shareLink.findMany()).reduce((n, l) => n + l.viewCount, 0),
  });

  it('refuses every token variant that is not exactly the one issued, without a server error', async () => {
    const { token } = await share();
    const variants = [
      `${token}=`, token.toUpperCase() === token ? token.toLowerCase() : token.toUpperCase(),
      `${token},${token}`, `${token.slice(0, 42)}`, `${token}A`, `Bearer ${token}`, encodeURIComponent(`${token}/`), 'A'.repeat(8000),
    ];
    for (const v of variants) {
      const res = await open(v);
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body.toString()).error.code).toBe('LINK_UNAVAILABLE');
    }
    // (Leading and trailing spaces are stripped by HTTP itself: they are the same token, not a variant.)
    expect(await recorded()).toEqual({ accesses: 0, audits: 0, views: 0 });
    await open(token).expect(200);
  });

  it('does not accept the stored hash, a check-in token or a session in place of the share token', async () => {
    const { token } = await share();
    const row = await t.prisma.shareLink.findFirstOrThrow();
    const checkinToken = randomToken();
    await t.prisma.checkInLink.create({ data: { accountId: a.accountId, bookingId, tokenHash: hashToken(checkinToken), expiresAt: new Date(Date.now() + DAY), createdBy: 'u', maxGuests: 1 } });

    expect((await open(row.tokenHash)).status).toBe(404); // someone holding a database copy cannot open the link
    expect((await open(checkinToken)).status).toBe(404); // tokens of one kind open nothing of another kind
    await server().get('/api/checkin').set('X-Checkin-Token', token).expect(404);
    await a.as.OWNER_MANAGER.get('/api/share').expect(404); // the manager's own session is not a share token
    expect(await recorded()).toEqual({ accesses: 0, audits: 0, views: 0 });
  });

  it('records no actor when the person opening a link is signed in to any account', async () => {
    const { token } = await share();
    await b.as.OWNER_MANAGER.get('/api/share').set(HEADER, token).expect(200);
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'share.accessed' } });
    expect([audit.accountId, audit.actorId, audit.ip]).toEqual([a.accountId, null, null]);
  });

  it('a HEAD request neither returns the file nor counts as an opening', async () => {
    const { token } = await share();
    const res = await server().head('/api/share').set(HEADER, token);
    expect(res.status).toBe(404);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(await recorded()).toEqual({ accesses: 0, audits: 0, views: 0 });
    await open(token).expect(200);
  });

  it('other methods on the public route answer without side effects', async () => {
    const { token } = await share();
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await server()[method]('/api/share').set(CSRF_HEADER, CSRF_HEADER_VALUE).set(HEADER, token);
      expect(res.status).toBe(404);
    }
    expect(await recorded()).toEqual({ accesses: 0, audits: 0, views: 0 });
    expect((await t.prisma.shareLink.findFirstOrThrow()).revokedAt).toBeNull();
  });

  it('serves the file with no validator, range or sniffing loophole', async () => {
    const { token } = await share();
    const res = await server().get('/api/share').set(HEADER, token).set('Range', 'bytes=0-3').set('Origin', 'https://evil.test').buffer(true).parse(binary);
    expect(res.status).toBe(200); // the whole file, one recorded opening; no partial content
    expect(res.body).toEqual(PDF);
    expect(res.headers.etag).toBeUndefined();
    expect(res.headers['last-modified']).toBeUndefined();
    expect(res.headers['accept-ranges']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    // A conditional request cannot turn into a 304 that confirms the file without recording an opening.
    const again = await server().get('/api/share').set(HEADER, token).set('If-None-Match', '*').set('If-Modified-Since', new Date().toUTCString());
    expect(again.status).toBe(200);
    expect(await recorded()).toEqual({ accesses: 2, audits: 2, views: 2 });
  });

  it('parallel openings never exceed the per-link cap, and views, accesses and audit rows agree', async () => {
    const { token } = await share();
    const statuses = await Promise.all(Array.from({ length: LINK_VIEWS_PER_WINDOW + 10 }, () => open(token).then((r) => r.status)));
    const served = statuses.filter((s) => s === 200).length;
    expect(served).toBe(LINK_VIEWS_PER_WINDOW);
    expect(statuses.filter((s) => s !== 200).every((s) => s === 429)).toBe(true);
    expect(await recorded()).toEqual({ accesses: served, audits: served, views: served });
  });

  it('stores a hostile user agent as inert, trimmed text', async () => {
    const { id, token } = await share();
    await server().get('/api/share').set(HEADER, token).set('User-Agent', `<script>alert(1)</script>\t\u00AD${'x'.repeat(5000)}`).expect(200);
    const [row] = (await a.as.OWNER_MANAGER.get(`/api/shares/${id}/access`).expect(200)).body as { userAgent: string }[];
    expect(row.userAgent.length).toBeLessThanOrEqual(120);
    expect(row.userAgent).not.toMatch(/[\t\u00AD]/); // control and format characters are dropped
    expect(row.userAgent.startsWith('<script>')).toBe(true); // kept as text; the screen renders it as text, never as markup
  });

  it('the manager routes refuse mass assignment, malformed bodies and cross-site requests without a server error', async () => {
    const base = { resourceType: 'FICHE_DE_POLICE', guestId, expiresInHours: 24, recipientLabel: 'Police' };
    const bad: object[] = [
      { ...base, accountId: b.accountId }, { ...base, tokenHash: 'a'.repeat(64) }, { ...base, expiresAt: '2099-01-01' }, { ...base, viewCount: -1 }, { ...base, resourceId: guestId },
      { ...base, expiresInHours: -24 }, { ...base, expiresInHours: 1e9 }, { ...base, expiresInHours: null }, { ...base, resourceType: 'STORED_OBJECT' },
      { ...base, guestId: "' OR 1=1 --" }, { resourceType: 'FICHE_DE_POLICE', propertyId: guestId, month: '2025-10', expiresInHours: 24, recipientLabel: 'Police' },
      { resourceType: 'POLICE_REGISTER', propertyId: guestId, month: "2025-10' OR '1'='1", expiresInHours: 24, recipientLabel: 'Police' },
      { resourceType: 'POLICE_REGISTER', propertyId: guestId, month: '2025-13', expiresInHours: 24, recipientLabel: 'Police' },
    ];
    for (const body of bad) expect((await a.as.OWNER_MANAGER.post('/api/shares', body)).status).toBe(400);
    for (const raw of ['{not json', '[]', 'null', '"x"']) {
      const res = await a.as.OWNER_MANAGER.post('/api/shares').set('Content-Type', 'application/json').send(raw);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    await a.as.OWNER_MANAGER.delete('/api/shares/not-a-uuid').expect(400);
    expect(await t.prisma.shareLink.count()).toBe(0);

    // Without the CSRF header, neither creating nor revoking works, even with a valid session.
    const { id } = await share();
    const agent = request.agent(t.app.getHttpServer());
    await agent.post('/api/auth/login').set(CSRF_HEADER, CSRF_HEADER_VALUE).send({ email: a.users.OWNER_MANAGER.email, password: PASSWORD }).expect(200);
    await agent.post('/api/shares').send(base).expect(403);
    await agent.delete(`/api/shares/${id}`).expect(403);
    expect((await t.prisma.shareLink.findUniqueOrThrow({ where: { id } })).revokedAt).toBeNull();
  });

  it("a manager cannot revoke, list or read the access log of another account's link", async () => {
    const { id, token } = await share();
    await b.as.OWNER_MANAGER.delete(`/api/shares/${id}`).expect(404);
    await b.as.OWNER_MANAGER.get(`/api/shares/${id}/access`).expect(404);
    expect((await b.as.OWNER_MANAGER.get('/api/shares').expect(200)).body).toEqual([]);
    await open(token).expect(200);
  });
});

describe('public share route headers outside the controller (integration, real limits)', () => {
  it('the per-address 429 and the flag-off 404 are never indexed and never cached', async () => {
    const limited = await createTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } });
    try {
      await resetDatabase(limited.prisma, limited.redis);
      let last: request.Response | undefined;
      for (let i = 0; i < 31; i++) last = await request(limited.app.getHttpServer()).get('/api/share').set(HEADER, 'A'.repeat(43));
      expect(last!.status).toBe(429);
      expect(last!.headers['cache-control']).toBe('no-store');
      expect(last!.headers['x-robots-tag']).toMatch(/noindex/);
      expect(last!.headers['referrer-policy']).toBe('no-referrer');
    } finally {
      await limited.app.close();
    }
    const off = await createTestApp({ env: { SECURE_SHARE_ENABLED: 'false' } });
    try {
      const res = await request(off.app.getHttpServer()).get('/api/share').set(HEADER, 'A'.repeat(43));
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    } finally {
      await off.app.close();
    }
  });
});
