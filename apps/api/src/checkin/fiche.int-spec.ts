import { createServer, Server } from 'node:http';
import { existsSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { MemoryObjectStore } from '../storage/memory-object-store';
import { OBJECT_STORE } from '../storage/object-store';
import { StorageService } from '../storage/storage.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { FicheService } from './fiche.service';
import { PdfRenderer } from './pdf-renderer';
import { TEMPLATE_VERSION } from './fiche-template';

requireDatabase();

/** These tests drive a real Chromium. CI sets REQUIRE_CHROMIUM=1 so a missing browser fails instead of skipping. */
function chromiumAvailable(): boolean {
  const path = process.env.PW_CHROMIUM_PATH;
  if (path) return existsSync(path);
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}
const haveChromium = chromiumAvailable();
if (!haveChromium && process.env.REQUIRE_CHROMIUM) throw new Error('REQUIRE_CHROMIUM is set but no Chromium was found');
const suite = haveChromium ? describe : describe.skip;

const DAY = 86_400_000;
/** Text of a PDF, extracted in a child process (pdf.js is ESM-only and cannot run inside Jest). */
const text = async (pdf: Buffer) => execFileSync(process.execPath, [join(__dirname, '../test/pdf-text.mjs')], { input: pdf, maxBuffer: 20 * 1024 * 1024 }).toString('utf8');

suite('Fiche de Police PDF (integration, real Chromium)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let propertyId: string;
  let guestId: string;
  let store: MemoryObjectStore;
  let fiche: FicheService;

  beforeAll(async () => {
    t = await createTestApp();
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
    fiche = t.app.get(FicheService);
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function makeGuest(accountId: string, over: Record<string, unknown> = {}) {
    const owner = await t.prisma.propertyOwner.create({ data: { accountId, name: 'Owner', residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({ data: { accountId, ownerId: owner.id, name: 'Riad Yasmine', address: '12 Derb Sidi Bouamar', commune: 'Marrakech', licenseType: 'RIAD' } });
    const booking = await t.prisma.booking.create({ data: { accountId, propertyId: property.id, checkIn: new Date(Date.now() + 10 * DAY), checkOut: new Date(Date.now() + 13 * DAY), source: 'DIRECT' } });
    const link = await t.prisma.checkInLink.create({ data: { accountId, bookingId: booking.id, tokenHash: `h-${accountId}-${Math.random()}`, expiresAt: new Date(Date.now() + 30 * DAY), createdBy: 'u', maxGuests: 2 } });
    const consent = await t.prisma.consentText.upsert({ where: { version_locale: { version: 'v1', locale: 'fr' } }, update: {}, create: { version: 'v1', locale: 'fr', body: 'x', approvedBy: 'c', approvedAt: new Date(Date.now() - DAY) } });
    const guest = await t.prisma.guestCheckIn.create({
      data: {
        accountId, bookingId: booking.id, propertyId: property.id, linkId: link.id, guestIndex: 1, status: 'SUBMITTED',
        docType: 'PASSPORT', fullName: 'Anna Maria Eriksson', nationality: 'SWE', docNumber: 'L898902C3', dob: new Date('1974-08-12'), docExpiryDate: new Date('2030-04-15'),
        entryStampNumber: 'CMN-2026-001', cityOfOrigin: 'Stockholm', nextDestination: 'Essaouira', profession: 'Engineer', consentTextId: consent.id, consentAt: new Date(), submittedAt: new Date(), ...over,
      },
    });
    return { property, guest };
  }

  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    for (const key of store.keys()) await store.delete(key);
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    ({ property: { id: propertyId }, guest: { id: guestId } } = await makeGuest(a.accountId));
  });

  it('generates a PDF with the guest, stay and property details, stored encrypted', async () => {
    const { templateVersion, sha256 } = await fiche.generate(a.accountId, guestId);
    expect(templateVersion).toBe(TEMPLATE_VERSION);

    const row = await t.prisma.ficheDePolice.findUniqueOrThrow({ where: { guestCheckInId: guestId }, include: { pdf: true } });
    expect(row).toMatchObject({ accountId: a.accountId, templateVersion: TEMPLATE_VERSION, sha256 });
    expect(row.pdf).toMatchObject({ kind: 'FICHE_PDF', accountId: a.accountId, deletedAt: null });

    // The bucket holds ciphertext, not a PDF.
    const raw = store.raw(row.pdf.key)!;
    expect(raw.subarray(0, 8).toString('latin1')).not.toContain('%PDF');
    expect(raw.includes(Buffer.from('Eriksson'))).toBe(false);

    // Decrypted: a real PDF whose checksum matches the recorded one, with the details on it.
    const { bytes } = await t.app.get(StorageService).read(a.accountId, row.pdfObjectId, { actorId: null, action: 'guest.fiche.read', resourceType: 'GuestCheckIn', resourceId: guestId });
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
    const content = await text(bytes);
    for (const expected of ['Riad Yasmine', 'Marrakech', 'Anna Maria Eriksson', 'L898902C3', '12/08/1974', 'CMN-2026-001', 'Stockholm', 'Essaouira', 'Engineer', 'Fiche de police', 'Mise en forme indicative']) {
      expect(content).toContain(expected);
    }
    expect(content).not.toMatch(/certif|garanti|complian|conforme/i);
  });

  it('renders Arabic names (an Arabic-capable font is embedded)', async () => {
    const arabic = 'محمد بن عبد الله';
    await t.prisma.guestCheckIn.update({ where: { id: guestId }, data: { fullName: arabic, cityOfOrigin: 'الدار البيضاء' } });
    await fiche.generate(a.accountId, guestId);
    const fiches = await t.prisma.ficheDePolice.findUniqueOrThrow({ where: { guestCheckInId: guestId } });
    const { bytes } = await t.app.get(StorageService).read(a.accountId, fiches.pdfObjectId, { actorId: null, action: 'guest.fiche.read', resourceType: 'GuestCheckIn', resourceId: guestId });
    const content = await text(bytes);
    // Extraction can reorder or join presentation forms; the letters must be there, not boxes or missing glyphs.
    expect(content).toMatch(/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFE]{4,}/);
    expect(bytes.toString('latin1')).toMatch(/\/Type\s*\/Font/);
    expect(content).not.toMatch(/�/);
  });

  it('regenerating replaces the PDF: one live object, the old one deleted and shredded', async () => {
    await fiche.generate(a.accountId, guestId);
    const first = await t.prisma.ficheDePolice.findUniqueOrThrow({ where: { guestCheckInId: guestId } });
    await t.prisma.guestCheckIn.update({ where: { id: guestId }, data: { profession: 'Photographer' } });

    await fiche.generate(a.accountId, guestId, a.users.OWNER_MANAGER.id);
    const second = await t.prisma.ficheDePolice.findUniqueOrThrow({ where: { guestCheckInId: guestId } });
    expect(second.pdfObjectId).not.toBe(first.pdfObjectId);
    expect(await t.prisma.ficheDePolice.count()).toBe(1);
    expect(store.keys()).toHaveLength(1);
    const old = await t.prisma.storedObject.findUniqueOrThrow({ where: { id: first.pdfObjectId } });
    expect(old.deletedAt).not.toBeNull();
    expect(old.wrappedKey).toBe('');

    const { bytes } = await t.app.get(StorageService).read(a.accountId, second.pdfObjectId, { actorId: null, action: 'guest.fiche.read', resourceType: 'GuestCheckIn', resourceId: guestId });
    expect(await text(bytes)).toContain('Photographer');
  });

  it('survives parallel generation for the same guest', async () => {
    await Promise.all([fiche.generate(a.accountId, guestId), fiche.generate(a.accountId, guestId), fiche.generate(a.accountId, guestId)]);
    expect(await t.prisma.ficheDePolice.count()).toBe(1);
    expect(store.keys()).toHaveLength(1);
    expect(await t.prisma.storedObject.count({ where: { deletedAt: null, kind: 'FICHE_PDF' } })).toBe(1);
  });

  it('does not create a Fiche for a draft or for another account', async () => {
    const draft = await t.prisma.guestCheckIn.update({ where: { id: guestId }, data: { status: 'PENDING' } });
    await expect(fiche.generate(a.accountId, draft.id)).rejects.toMatchObject({ status: 404 });
    await t.prisma.guestCheckIn.update({ where: { id: guestId }, data: { status: 'SUBMITTED' } });
    await expect(fiche.generate(b.accountId, guestId)).rejects.toMatchObject({ status: 404 });
    expect(await t.prisma.ficheDePolice.count()).toBe(0);
  });

  describe('routes', () => {
    it('serves the PDF to Owner/Manager only, no-store, and audits every read', async () => {
      await fiche.generate(a.accountId, guestId);
      const res = await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}/fiche`).buffer(true).parse(binary).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toBe('attachment; filename="fiche-de-police.pdf"');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

      await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}/fiche`).buffer(true).parse(binary).expect(200);
      const reads = await t.prisma.auditLog.findMany({ where: { action: 'guest.fiche.read' } });
      expect(reads).toHaveLength(2);
      expect(reads.every((r) => r.actorId === a.users.OWNER_MANAGER.id && r.resourceId === guestId)).toBe(true);

      await a.as.STAFF.get(`/api/guests/${guestId}/fiche`).expect(403);
      await a.as.ACCOUNTANT.get(`/api/guests/${guestId}/fiche`).expect(403);
      await a.as.ANON.get(`/api/guests/${guestId}/fiche`).expect(401);
      await b.as.OWNER_MANAGER.get(`/api/guests/${guestId}/fiche`).expect(404);
      expect(await t.prisma.auditLog.count({ where: { action: 'guest.fiche.read' } })).toBe(2);
    });

    it('404 before a Fiche exists; regenerate creates it and reflects a manager correction', async () => {
      await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}/fiche`).expect(404);
      await a.as.OWNER_MANAGER.patch(`/api/guests/${guestId}`, { profession: 'Architect' }).expect(200);
      const res = await a.as.OWNER_MANAGER.post(`/api/guests/${guestId}/fiche/regenerate`).expect(200);
      expect(res.body.templateVersion).toBe(TEMPLATE_VERSION);
      const pdf = (await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}/fiche`).buffer(true).parse(binary).expect(200)).body as Buffer;
      expect(await text(pdf)).toContain('Architect');
      await a.as.STAFF.post(`/api/guests/${guestId}/fiche/regenerate`).expect(403);
      await b.as.OWNER_MANAGER.post(`/api/guests/${guestId}/fiche/regenerate`).expect(404);
      // Only the successful regeneration by Owner/Manager is on record.
      const rows = await t.prisma.auditLog.findMany({ where: { action: 'guest.fiche.regenerated' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ accountId: a.accountId, actorId: a.users.OWNER_MANAGER.id, resourceType: 'GuestCheckIn', resourceId: guestId });
    });

    it('shows Staff and Owner/Manager whether a Fiche exists, without exposing it to Staff', async () => {
      expect((await a.as.STAFF.get(`/api/guests/${guestId}`)).body.hasFiche).toBe(false);
      await fiche.generate(a.accountId, guestId);
      expect((await a.as.STAFF.get(`/api/guests/${guestId}`)).body.hasFiche).toBe(true);
      const arrivals = (await a.as.STAFF.get(`/api/properties/${propertyId}/arrivals`)).body;
      expect(arrivals[0].guests[0].hasFiche).toBe(true);
    });
  });

  describe('the renderer is locked down', () => {
    let server: Server;
    let hits: string[];
    let base: string;

    beforeAll(async () => {
      hits = [];
      server = createServer((req, res) => {
        hits.push(req.url ?? '');
        res.end('x');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('fetches nothing over the network and runs no JavaScript', async () => {
      const html = `<!doctype html><html><head><title>t</title><link rel="stylesheet" href="${base}/css"></head><body>
        <img src="${base}/img"><iframe src="${base}/frame"></iframe>
        <script src="${base}/js"></script><script>document.body.innerHTML = 'SCRIPT-RAN'; fetch('${base}/beacon');</script>
        <p>STATIC-TEXT</p></body></html>`;
      const content = await text(await t.app.get(PdfRenderer).render(html));
      expect(content).toContain('STATIC-TEXT');
      expect(content).not.toContain('SCRIPT-RAN');
      expect(hits).toEqual([]);
    });
  });
});

/** supertest parser that keeps binary bodies as a Buffer. */
function binary(res: import('supertest').Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
