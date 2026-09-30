import request from 'supertest';
import { AuditService } from '../audit/audit.service';
import { PdfRenderer } from '../checkin/pdf-renderer';
import { RetentionService } from '../retention/retention.service';
import { MemoryObjectStore } from '../storage/memory-object-store';
import { OBJECT_STORE } from '../storage/object-store';
import { StorageService } from '../storage/storage.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { LINK_VIEWS_PER_WINDOW } from './share.service';

requireDatabase();

const DAY = 86_400_000;
const HEADER = 'X-Share-Token';
const FICHE_BYTES = Buffer.from('%PDF-1.4 fiche stub');

function binary(res: import('supertest').Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Secure Share (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let store: MemoryObjectStore;
  let propertyId: string;
  let guestId: string;
  let ficheId: string;

  beforeAll(async () => {
    t = await createTestApp();
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function fixtures(accountId: string) {
    const owner = await t.prisma.propertyOwner.create({ data: { accountId, name: 'Owner', residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({ data: { accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } });
    const booking = await t.prisma.booking.create({ data: { accountId, propertyId: property.id, checkIn: new Date('2025-10-04'), checkOut: new Date('2025-10-06'), source: 'DIRECT' } });
    const link = await t.prisma.checkInLink.create({ data: { accountId, bookingId: booking.id, tokenHash: `h-${Math.random()}`, expiresAt: new Date(Date.now() + DAY), createdBy: 'u', maxGuests: 1 } });
    const guest = await t.prisma.guestCheckIn.create({
      data: {
        accountId, bookingId: booking.id, propertyId: property.id, linkId: link.id, guestIndex: 1, status: 'VERIFIED', docType: 'PASSPORT', fullName: 'Anna Eriksson', nationality: 'SWE',
        docNumber: 'L898902C3', dob: new Date('1974-08-12'), entryStampNumber: 'S1', cityOfOrigin: 'Stockholm', nextDestination: 'Fès', profession: 'Engineer', submittedAt: new Date(),
      },
    });
    const pdf = await t.app.get(StorageService).put(accountId, 'FICHE_PDF', FICHE_BYTES);
    const fiche = await t.prisma.ficheDePolice.create({ data: { accountId, guestCheckInId: guest.id, pdfObjectId: pdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64) } });
    return { propertyId: property.id, guestId: guest.id, ficheId: fiche.id };
  }

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(t.app.get(PdfRenderer), 'render').mockResolvedValue(Buffer.from('%PDF-1.4 register stub'));
    await resetDatabase(t.prisma, t.redis);
    for (const key of store.keys()) await store.delete(key);
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    ({ propertyId, guestId, ficheId } = await fixtures(a.accountId));
  });

  const shareFiche = (over: Record<string, unknown> = {}, as = a.as.OWNER_MANAGER) =>
    as.post('/api/shares', { resourceType: 'FICHE_DE_POLICE', guestId, expiresInHours: 48, recipientLabel: 'Préfecture de Marrakech', ...over });
  const open = (token: string | undefined, ua = 'Mozilla/5.0 (iPhone)') => {
    const req = request(t.app.getHttpServer()).get('/api/share').set('User-Agent', ua);
    return (token === undefined ? req : req.set(HEADER, token)).buffer(true).parse(binary);
  };

  describe('creating a link', () => {
    it('returns the token and a fragment URL once, stores only the hash, and audits', async () => {
      const res = await shareFiche().expect(201);
      expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits
      expect(res.body.url).toMatch(/\/s#token=[A-Za-z0-9_-]{43}$/);
      expect(res.body).toMatchObject({ resourceType: 'FICHE_DE_POLICE', resource: { guestId }, status: 'ACTIVE', viewCount: 0, recipientLabel: 'Préfecture de Marrakech' });
      const hours = (new Date(res.body.expiresAt).getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(47.9);
      expect(hours).toBeLessThanOrEqual(48);

      const row = await t.prisma.shareLink.findFirstOrThrow();
      expect(row.resourceId).toBe(ficheId);
      expect(JSON.stringify(row)).not.toContain(res.body.token);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      const list = (await a.as.OWNER_MANAGER.get('/api/shares').expect(200)).body;
      expect(JSON.stringify(list)).not.toContain(res.body.token);
      expect(JSON.stringify(list)).not.toContain(row.tokenHash);
      expect(list[0]).not.toHaveProperty('token');

      const audit = await t.prisma.auditLog.findMany({ where: { action: 'share.created' } });
      expect(audit.map((r) => [r.actorId, r.resourceType, r.resourceId])).toEqual([[a.users.OWNER_MANAGER.id, 'ShareLink', row.id]]);
      expect(JSON.stringify(await t.prisma.auditLog.findMany())).not.toContain(res.body.token);
    });

    it('refuses an expiry outside the RuleConfig bounds, and follows the bounds when counsel changes them', async () => {
      for (const h of [23, 73]) expect((await shareFiche({ expiresInHours: h }).expect(422)).body.error.code).toBe('EXPIRY_OUT_OF_BOUNDS');
      for (const h of [0, 169, 2.5, '48']) await shareFiche({ expiresInHours: h }).expect(400);
      await t.prisma.ruleConfig.createMany({ data: [{ key: 'share.min_hours', value: { hours: 1 } }, { key: 'share.max_hours', value: { hours: 12 } }] });
      await shareFiche({ expiresInHours: 2 }).expect(201);
      await shareFiche({ expiresInHours: 24 }).expect(422);
      expect(await t.prisma.shareLink.count()).toBe(1);
    });

    it('validates the recipient label: 2 to 80 characters, no markup, no control characters', async () => {
      for (const label of ['x', 'y'.repeat(81), '<b>Police</b>', '\u202EPolice', 'Zero\u200Bwidth']) await shareFiche({ recipientLabel: label }).expect(400);
      await shareFiche({ unknown: 1 }).expect(400);
      expect(await t.prisma.shareLink.count()).toBe(0);
      // Line breaks and runs of spaces are folded, as for every free-text field.
      expect((await shareFiche({ recipientLabel: '  Commissariat\n  Guéliz ' }).expect(201)).body.recipientLabel).toBe('Commissariat Guéliz');
    });

    it("refuses another account's Fiche or register, a Fiche that does not exist and a purged one", async () => {
      const other = await fixtures(b.accountId);
      await shareFiche({ guestId: other.guestId }).expect(404);
      await shareFiche({ guestId: '11111111-1111-4111-8111-111111111111' }).expect(404);
      await b.as.OWNER_MANAGER.post(`/api/properties/${other.propertyId}/registers/2025-10`).expect(200);
      await a.as.OWNER_MANAGER.post('/api/shares', { resourceType: 'POLICE_REGISTER', propertyId: other.propertyId, month: '2025-10', expiresInHours: 24, recipientLabel: 'Police' }).expect(404);
      const fiche = await t.prisma.ficheDePolice.findUniqueOrThrow({ where: { id: ficheId } });
      await t.app.get(StorageService).delete(a.accountId, fiche.pdfObjectId, { actorId: null, action: 'retention.purged', resourceType: 'StoredObject', resourceId: fiche.pdfObjectId });
      await shareFiche().expect(404);
      expect(await t.prisma.shareLink.count()).toBe(0);
    });

    it('shares a current register, and refuses an outdated one until it is regenerated', async () => {
      const body = { resourceType: 'POLICE_REGISTER', propertyId, month: '2025-10', expiresInHours: 24, recipientLabel: 'Police' };
      await a.as.OWNER_MANAGER.post('/api/shares', body).expect(404); // not generated yet
      await a.as.OWNER_MANAGER.post(`/api/properties/${propertyId}/registers/2025-10`).expect(200);
      const ok = await a.as.OWNER_MANAGER.post('/api/shares', body).expect(201);
      expect(ok.body.resource).toEqual({ propertyId, month: '2025-10' });

      await t.prisma.guestCheckIn.update({ where: { id: guestId }, data: { profession: 'Photographer' } });
      expect((await a.as.OWNER_MANAGER.post('/api/shares', body).expect(409)).body.error.code).toBe('REGISTER_OUTDATED');
      await a.as.OWNER_MANAGER.post(`/api/properties/${propertyId}/registers/2025-10`).expect(200);
      await a.as.OWNER_MANAGER.post('/api/shares', body).expect(201);
      // The first link still works and now serves the regenerated register.
      expect((await open(ok.body.token).expect(200)).body.toString()).toBe('%PDF-1.4 register stub');
    });

    it('is Owner/Manager only', async () => {
      await shareFiche({}, a.as.STAFF).expect(403);
      await shareFiche({}, a.as.ACCOUNTANT).expect(403);
      await shareFiche({}, a.as.ANON).expect(401);
    });
  });

  describe('opening a link', () => {
    it('serves the PDF inline, no-store, noindex, and records the access before returning it', async () => {
      const { token, id } = (await shareFiche().expect(201)).body;
      const res = await open(token, `Mozilla/5.0 (iPhone)${'x'.repeat(300)}`).expect(200);
      expect(res.body).toEqual(FICHE_BYTES);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe('inline; filename="document.pdf"');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toContain('noindex');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBeUndefined();

      const access = (await a.as.OWNER_MANAGER.get(`/api/shares/${id}/access`).expect(200)).body;
      expect(access).toHaveLength(1);
      expect(Object.keys(access[0]).sort()).toEqual(['at', 'userAgent']);
      expect(access[0].userAgent).toBe(`Mozilla/5.0 (iPhone)${'x'.repeat(100)}`); // trimmed to 120
      const row = await t.prisma.shareAccess.findFirstOrThrow();
      expect(row).not.toHaveProperty('ip');
      expect((await t.prisma.shareLink.findFirstOrThrow()).viewCount).toBe(1);
      const audit = await t.prisma.auditLog.findMany({ where: { action: 'share.accessed' } });
      expect(audit.map((r) => [r.accountId, r.actorId, r.resourceType, r.resourceId, r.ip])).toEqual([[a.accountId, null, 'ShareLink', id, null]]);
    });

    it('answers unknown, malformed, expired, revoked and purged links identically, and records nothing', async () => {
      const revoked = (await shareFiche().expect(201)).body;
      await a.as.OWNER_MANAGER.delete(`/api/shares/${revoked.id}`).expect(204);
      const expired = (await shareFiche().expect(201)).body;
      await t.prisma.shareLink.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const purged = (await shareFiche().expect(201)).body;
      const fiche = await t.prisma.ficheDePolice.findUniqueOrThrow({ where: { id: ficheId } });
      await t.app.get(StorageService).delete(a.accountId, fiche.pdfObjectId, { actorId: null, action: 'retention.purged', resourceType: 'StoredObject', resourceId: fiche.pdfObjectId });

      const answers = [];
      for (const token of [undefined, '', 'short', 'A'.repeat(43), 'A'.repeat(44), `${'A'.repeat(42)}!`, revoked.token, expired.token, purged.token]) {
        const res = await open(token);
        answers.push({ status: res.status, body: JSON.parse(res.body.toString()).error, cache: res.headers['cache-control'], robots: res.headers['x-robots-tag'], type: res.headers['content-type'] });
      }
      expect(new Set(answers.map((x) => JSON.stringify(x))).size).toBe(1);
      expect(answers[0]).toMatchObject({ status: 404, body: { code: 'LINK_UNAVAILABLE' }, cache: 'no-store' });
      expect(await t.prisma.shareAccess.count()).toBe(0);
      expect(await t.prisma.auditLog.count({ where: { action: 'share.accessed' } })).toBe(0);
    });

    it('revocation takes effect on the very next request', async () => {
      const { token, id } = (await shareFiche().expect(201)).body;
      await open(token).expect(200);
      await a.as.OWNER_MANAGER.delete(`/api/shares/${id}`).expect(204);
      await open(token).expect(404);
      await a.as.OWNER_MANAGER.delete(`/api/shares/${id}`).expect(204); // idempotent
      expect(await t.prisma.auditLog.count({ where: { action: 'share.revoked' } })).toBe(1);
      expect((await a.as.OWNER_MANAGER.get('/api/shares').expect(200)).body[0]).toMatchObject({ status: 'REVOKED', viewCount: 1 });
    });

    it('fails closed: without the audit row, no byte and no access recorded', async () => {
      const { token } = (await shareFiche().expect(201)).body;
      jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValue(new Error('audit down'));
      const res = await open(token);
      expect(res.status).toBe(500);
      expect(res.body.subarray(0, 5).toString()).not.toBe('%PDF-');
      expect(await t.prisma.shareAccess.count()).toBe(0);
    });

    it('fails closed when the access cannot be recorded', async () => {
      const { token } = (await shareFiche().expect(201)).body;
      jest.spyOn(t.prisma, '$transaction').mockRejectedValueOnce(new Error('db down'));
      const res = await open(token);
      expect(res.status).toBe(500);
      expect(res.body.subarray(0, 5).toString()).not.toBe('%PDF-');
    });

    it('a revocation that lands during the read wins: no bytes', async () => {
      const { token, id } = (await shareFiche().expect(201)).body;
      const storage = t.app.get(StorageService);
      const read = storage.read.bind(storage);
      jest.spyOn(storage, 'read').mockImplementationOnce(async (...args) => {
        const out = await read(...args);
        await t.prisma.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
        return out;
      });
      await open(token).expect(404);
      expect(await t.prisma.shareAccess.count()).toBe(0);
    });

    it('accepts the token only in the header: path, query, cookie and other headers give the neutral 404', async () => {
      const { token } = (await shareFiche().expect(201)).body;
      const server = t.app.getHttpServer();
      await request(server).get(`/api/share?token=${token}`).expect(404);
      await request(server).get(`/api/share/${token}`).expect(404);
      await request(server).get('/api/share').set('Cookie', `token=${token}`).expect(404);
      await request(server).get('/api/share').set('Authorization', `Bearer ${token}`).expect(404);
      await request(server).get('/api/share').set('X-Checkin-Token', token).expect(404);
      expect(await t.prisma.shareAccess.count()).toBe(0);
    });

    it(`caps views of one link at ${LINK_VIEWS_PER_WINDOW} per window, without touching another link`, async () => {
      const one = (await shareFiche().expect(201)).body.token;
      const two = (await shareFiche().expect(201)).body.token;
      for (let i = 0; i < LINK_VIEWS_PER_WINDOW; i++) await open(one).expect(200);
      const res = await open(one).expect(429);
      expect(JSON.parse(res.body.toString()).error.code).toBe('TOO_MANY_VIEWS');
      expect(res.headers['cache-control']).toBe('no-store');
      await open(two).expect(200);
      expect(await t.prisma.shareAccess.count()).toBe(LINK_VIEWS_PER_WINDOW + 1);
    });
  });

  describe('lifetime bounds', () => {
    it('are served to the manager, from RuleConfig, and to nobody else', async () => {
      expect((await a.as.OWNER_MANAGER.get('/api/shares/lifetime').expect(200)).body).toEqual({ minHours: 24, maxHours: 72, validated: false });
      await t.prisma.ruleConfig.createMany({ data: [{ key: 'share.min_hours', value: { hours: 2 }, validatedBy: 'Counsel' }, { key: 'share.max_hours', value: { hours: 36 }, validatedBy: 'Counsel' }] });
      expect((await a.as.OWNER_MANAGER.get('/api/shares/lifetime').expect(200)).body).toEqual({ minHours: 2, maxHours: 36, validated: true });
      await a.as.STAFF.get('/api/shares/lifetime').expect(403);
    });
  });

  describe('list and access log', () => {
    it('lists the links with status, views and last access; another account sees none of it', async () => {
      const { id, token } = (await shareFiche().expect(201)).body;
      await open(token).expect(200);
      const [row] = (await a.as.OWNER_MANAGER.get('/api/shares').expect(200)).body;
      expect(row).toMatchObject({ id, status: 'ACTIVE', viewCount: 1, resource: { guestId } });
      expect(row.lastAccessAt).not.toBeNull();
      expect((await b.as.OWNER_MANAGER.get('/api/shares').expect(200)).body).toEqual([]);
      await b.as.OWNER_MANAGER.get(`/api/shares/${id}/access`).expect(404);
      await b.as.OWNER_MANAGER.delete(`/api/shares/${id}`).expect(404);
      await open(token).expect(200); // B's revoke did nothing
      await a.as.STAFF.get('/api/shares').expect(403);
      await a.as.STAFF.get(`/api/shares/${id}/access`).expect(403);
    });
  });

  describe('retention', () => {
    it('revokes the links of a Fiche whose PDF is purged, audited without an actor', async () => {
      const { id, token } = (await shareFiche().expect(201)).body;
      await t.prisma.ruleConfig.create({ data: { key: 'retention.fiche_days', value: { days: 30 }, validatedBy: 'Counsel' } });
      await t.app.get(RetentionService).purge(new Date(Date.now() + 400 * DAY));
      expect((await t.prisma.shareLink.findUniqueOrThrow({ where: { id } })).revokedAt).not.toBeNull();
      const audit = await t.prisma.auditLog.findMany({ where: { action: 'share.revoked' } });
      expect(audit.map((r) => [r.actorId, r.resourceId])).toEqual([[null, id]]);
      await open(token).expect(404);
    });

    it('revokes the links of a register that is purged', async () => {
      await a.as.OWNER_MANAGER.post(`/api/properties/${propertyId}/registers/2025-10`).expect(200);
      const { id } = (await a.as.OWNER_MANAGER.post('/api/shares', { resourceType: 'POLICE_REGISTER', propertyId, month: '2025-10', expiresInHours: 24, recipientLabel: 'Police' }).expect(201)).body;
      await t.prisma.ruleConfig.create({ data: { key: 'retention.police_register_days', value: { days: 30 }, validatedBy: 'Counsel' } });
      await t.app.get(RetentionService).purge(new Date('2026-01-15T00:00:00Z'));
      expect(await t.prisma.policeRegister.count()).toBe(0);
      expect((await t.prisma.shareLink.findUniqueOrThrow({ where: { id } })).revokedAt).not.toBeNull();
    });
  });
});

describe('Secure Share flag (integration)', () => {
  it('answers 404 on every route when SECURE_SHARE_ENABLED is off', async () => {
    const t = await createTestApp({ env: { SECURE_SHARE_ENABLED: 'false' } });
    try {
      await resetDatabase(t.prisma, t.redis);
      const a = await seedAccount(t, 'Alpha');
      const id = '11111111-1111-4111-8111-111111111111';
      await a.as.OWNER_MANAGER.get('/api/shares').expect(404);
      await a.as.OWNER_MANAGER.post('/api/shares', {}).expect(404);
      await a.as.OWNER_MANAGER.delete(`/api/shares/${id}`).expect(404);
      await a.as.OWNER_MANAGER.get(`/api/shares/${id}/access`).expect(404);
      await request(t.app.getHttpServer()).get('/api/share').set(HEADER, 'A'.repeat(43)).expect(404);
    } finally {
      await t.app.close();
    }
  });
});

describe('Secure Share per-address limit (integration, real limits)', () => {
  it('caps guessing on the public route at 30 a minute per address, with a clean 429', async () => {
    const t = await createTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } });
    try {
      await resetDatabase(t.prisma, t.redis);
      const statuses: number[] = [];
      for (let i = 0; i < 31; i++) statuses.push((await request(t.app.getHttpServer()).get('/api/share').set(HEADER, 'A'.repeat(43))).status);
      expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
      const last = await request(t.app.getHttpServer()).get('/api/share').set(HEADER, 'A'.repeat(43));
      expect(last.status).toBe(429);
      expect(last.headers['cache-control']).toBe('no-store');
    } finally {
      await t.app.close();
    }
  });
});
