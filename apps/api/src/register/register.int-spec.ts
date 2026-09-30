import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { AuditService } from '../audit/audit.service';
import { PdfRenderer } from '../checkin/pdf-renderer';
import { RetentionService } from '../retention/retention.service';
import { MemoryObjectStore } from '../storage/memory-object-store';
import { OBJECT_STORE } from '../storage/object-store';
import { StorageService } from '../storage/storage.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { REGISTER_TEMPLATE_VERSION } from './register-template';
import { RegisterService } from './register.service';

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

/** Text of a PDF, extracted in a child process (pdf.js is ESM-only and cannot run inside Jest). */
const text = async (pdf: Buffer) => execFileSync(process.execPath, [join(__dirname, '../test/pdf-text.mjs')], { input: pdf, maxBuffer: 20 * 1024 * 1024 }).toString('utf8');
function binary(res: import('supertest').Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

suite('Police register (integration, real Chromium)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let propertyId: string;
  let store: MemoryObjectStore;
  let svc: RegisterService;
  let consentId: string;

  beforeAll(async () => {
    t = await createTestApp();
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
    svc = t.app.get(RegisterService);
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function property(accountId: string) {
    const owner = await t.prisma.propertyOwner.create({ data: { accountId, name: 'Owner', residency: 'RESIDENT' } });
    return (await t.prisma.property.create({ data: { accountId, ownerId: owner.id, name: 'Riad Yasmine', address: '12 Derb Sidi Bouamar', commune: 'Marrakech', licenseType: 'RIAD' } })).id;
  }
  /** A stay, with one submitted guest named `name` (or none when `name` is null). */
  async function stay(accountId: string, propId: string, checkIn: string, checkOut: string, name: string | null, over: { booking?: Record<string, unknown>; guest?: Record<string, unknown> } = {}) {
    const booking = await t.prisma.booking.create({ data: { accountId, propertyId: propId, checkIn: new Date(checkIn), checkOut: new Date(checkOut), source: 'DIRECT', ...over.booking } });
    if (name === null) return { booking, guest: null };
    const link = await t.prisma.checkInLink.create({ data: { accountId, bookingId: booking.id, tokenHash: `h-${Math.random()}`, expiresAt: new Date(Date.now() + 86_400_000), createdBy: 'u', maxGuests: 2 } });
    const guest = await t.prisma.guestCheckIn.create({
      data: {
        accountId, bookingId: booking.id, propertyId: propId, linkId: link.id, guestIndex: 1, status: 'VERIFIED', docType: 'PASSPORT', fullName: name, nationality: 'SWE', docNumber: `N-${name.replace(/\W/g, '')}`,
        dob: new Date('1974-08-12'), entryStampNumber: 'CMN-1', cityOfOrigin: 'Stockholm', nextDestination: 'Essaouira', profession: 'Engineer', consentTextId: consentId, consentAt: new Date(), submittedAt: new Date(), ...over.guest,
      },
    });
    return { booking, guest };
  }
  const pdfOf = async (accountId: string, propId: string, month: string) => {
    const row = await t.prisma.policeRegister.findFirstOrThrow({ where: { propertyId: propId, month } });
    return (await t.app.get(StorageService).read(accountId, row.pdfObjectId, { actorId: null, action: 'register.read', resourceType: 'PoliceRegister', resourceId: row.id })).bytes;
  };
  const generate = (month = '2025-10') => a.as.OWNER_MANAGER.post(`/api/properties/${propertyId}/registers/${month}`);

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(t.prisma, t.redis);
    for (const key of store.keys()) await store.delete(key);
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    propertyId = await property(a.accountId);
    consentId = (await t.prisma.consentText.create({ data: { version: 'v1', locale: 'fr', body: 'x', approvedBy: 'c', approvedAt: new Date(Date.now() - 86_400_000) } })).id;
  });

  describe('which guests are in a month', () => {
    it('lists a guest exactly once, under the month of arrival, and notes a stay that goes on', async () => {
      await stay(a.accountId, propertyId, '2025-10-01', '2025-10-03', 'Alice First'); // first day of October
      await stay(a.accountId, propertyId, '2025-10-30', '2025-11-04', 'Bruno Crossing'); // arrives in October, leaves in November
      await stay(a.accountId, propertyId, '2025-11-01', '2025-11-02', 'Carla November'); // first day of November
      await stay(a.accountId, propertyId, '2025-09-30', '2025-10-02', 'Dario September'); // arrives the day before

      await generate('2025-10').expect(200);
      await generate('2025-11').expect(200);
      await generate('2025-09').expect(200);
      const [oct, nov, sep] = await Promise.all([pdfOf(a.accountId, propertyId, '2025-10'), pdfOf(a.accountId, propertyId, '2025-11'), pdfOf(a.accountId, propertyId, '2025-09')].map(async (p) => text(await p)));

      for (const name of ['Alice First', 'Bruno Crossing', 'Carla November', 'Dario September']) {
        expect(count(oct, name) + count(nov, name) + count(sep, name)).toBe(1);
      }
      expect(oct).toContain('Alice First');
      expect(oct).toContain('Bruno Crossing');
      expect(oct).toContain('†');
      expect(oct).toContain('Séjour se poursuivant le mois suivant');
      expect(nov).toContain('Carla November');
      expect(nov).not.toContain('Bruno Crossing');
      expect(sep).toContain('Dario September');
    });

    it('leaves out cancelled stays, owner blocks and uncertain events', async () => {
      await stay(a.accountId, propertyId, '2025-10-05', '2025-10-07', 'Kept Guest');
      await stay(a.accountId, propertyId, '2025-10-08', '2025-10-09', 'Cancelled Guest', { booking: { status: 'CANCELLED' } });
      await stay(a.accountId, propertyId, '2025-10-10', '2025-10-11', 'Blocked Guest', { booking: { classification: 'OWNER_BLOCK' } });
      await stay(a.accountId, propertyId, '2025-10-12', '2025-10-13', 'Uncertain Guest', { booking: { classification: 'UNCERTAIN' } });
      await generate().expect(200);
      const content = await text(await pdfOf(a.accountId, propertyId, '2025-10'));
      expect(content).toContain('Kept Guest');
      for (const n of ['Cancelled Guest', 'Blocked Guest', 'Uncertain Guest']) expect(content).not.toContain(n);
    });

    it('does not list a draft, and does not mix in another property or account', async () => {
      const other = await property(a.accountId);
      await stay(a.accountId, other, '2025-10-05', '2025-10-06', 'Other Property');
      const foreign = await property(b.accountId);
      await stay(b.accountId, foreign, '2025-10-05', '2025-10-06', 'Foreign Account');
      await stay(a.accountId, propertyId, '2025-10-06', '2025-10-08', 'Draft Guest', { guest: { status: 'PENDING', guestIndex: null } });
      await generate().expect(200);
      const content = await text(await pdfOf(a.accountId, propertyId, '2025-10'));
      for (const n of ['Other Property', 'Foreign Account', 'Draft Guest']) expect(content).not.toContain(n);
    });
  });

  describe('validation report', () => {
    it('reports incomplete records by id and problem, never a name or a value', async () => {
      const ok = await stay(a.accountId, propertyId, '2025-10-02', '2025-10-04', 'Complete Guest');
      const none = await stay(a.accountId, propertyId, '2025-10-03', '2025-10-05', null);
      const missing = await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Gap Guest', { guest: { entryStampNumber: null } });
      const draft = await stay(a.accountId, propertyId, '2025-10-05', '2025-10-07', 'Draft Guest', { guest: { status: 'PENDING', guestIndex: null } });
      const unverified = await stay(a.accountId, propertyId, '2025-10-06', '2025-10-08', 'Unverified Guest', { guest: { status: 'SUBMITTED' } });

      const res = await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/registers/2025-10/validation`).expect(200);
      expect(res.body.problems).toEqual([
        { kind: 'NO_CHECKIN', bookingId: none.booking.id },
        { kind: 'MISSING_FIELD', bookingId: missing.booking.id, guestId: missing.guest!.id, fields: ['entryStampNumber'] },
        { kind: 'DRAFT', bookingId: draft.booking.id, guestId: draft.guest!.id },
        { kind: 'UNVERIFIED', bookingId: unverified.booking.id, guestId: unverified.guest!.id },
      ]);
      expect(res.body.summary).toMatchObject({ stays: 5, guests: 3, problems: 4 });
      expect(res.body.stays[none.booking.id]).toEqual({ checkIn: '2025-10-03T00:00:00.000Z', checkOut: '2025-10-05T00:00:00.000Z' });
      expect(Object.keys(res.body.stays).sort()).toEqual([none.booking.id, missing.booking.id, draft.booking.id, unverified.booking.id].sort()); // only stays named in a problem
      expect(JSON.stringify(res.body)).not.toMatch(/Guest|Stockholm|Engineer|N-/);
      expect(ok.guest).not.toBeNull();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('is also returned after generating, and the PDF says it is incomplete', async () => {
      await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Gap Guest', { guest: { profession: null } });
      const res = await generate().expect(200);
      expect(res.body.problems).toHaveLength(1);
      expect(res.body.summary.problems).toBe(1);
      expect(await text(await pdfOf(a.accountId, propertyId, '2025-10'))).toContain('1 point(s) incomplet(s)');
      const row = await t.prisma.policeRegister.findFirstOrThrow();
      expect(JSON.stringify(row.validation)).not.toMatch(/Gap|Stockholm/); // counts only
    });
  });

  describe('generating', () => {
    it('stores an encrypted PDF with the guests, a checksum, the template version and an audit row', async () => {
      const { guest } = await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Maria Eriksson');
      const res = await generate().expect(200);
      expect(res.body).toMatchObject({ month: '2025-10', templateVersion: REGISTER_TEMPLATE_VERSION, summary: { guests: 1, problems: 0 } });

      const row = await t.prisma.policeRegister.findFirstOrThrow({ include: { pdf: true } });
      expect(row).toMatchObject({ accountId: a.accountId, propertyId, month: '2025-10', guestCount: 1, generatedBy: a.users.OWNER_MANAGER.id, templateVersion: REGISTER_TEMPLATE_VERSION });
      expect(row.pdf).toMatchObject({ kind: 'POLICE_REGISTER_PDF', accountId: a.accountId, deletedAt: null });
      const raw = store.raw(row.pdf.key)!;
      expect(raw.subarray(0, 8).toString('latin1')).not.toContain('%PDF');
      expect(raw.includes(Buffer.from('Eriksson'))).toBe(false);

      const bytes = await pdfOf(a.accountId, propertyId, '2025-10');
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
      const content = await text(bytes);
      for (const s of ['Registre de police', 'Riad Yasmine', 'Marrakech', '10/2025', '04/10/2025', '06/10/2025', 'Anna Maria Eriksson', '12/08/1974', 'SWE', 'CMN-1', 'Stockholm', 'Essaouira', 'Engineer', 'Mise en forme indicative']) expect(content).toContain(s);
      expect(content.replace(/\s+/g, '')).toContain(guest!.docNumber); // a long number may wrap inside its cell
      expect(content).not.toMatch(/certif|garanti|complian|conforme/i);

      const audit = await t.prisma.auditLog.findMany({ where: { action: 'register.generated' } });
      expect(audit.map((r) => [r.accountId, r.actorId, r.resourceType, r.resourceId])).toEqual([[a.accountId, a.users.OWNER_MANAGER.id, 'PoliceRegister', row.id]]);
      expect(JSON.stringify(audit)).not.toMatch(/Eriksson|Stockholm/);
    });

    it('generates an empty register for a month with no guest', async () => {
      await generate('2025-03').expect(200);
      expect(await text(await pdfOf(a.accountId, propertyId, '2025-03'))).toContain('Aucun voyageur enregistré');
    });

    it('regenerating replaces the row and shreds the previous PDF', async () => {
      await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Eriksson');
      await generate().expect(200);
      const first = await t.prisma.policeRegister.findFirstOrThrow();
      await t.prisma.guestCheckIn.updateMany({ data: { profession: 'Photographer' } });

      await generate().expect(200);
      const second = await t.prisma.policeRegister.findFirstOrThrow();
      expect(await t.prisma.policeRegister.count()).toBe(1);
      expect(second.id).toBe(first.id);
      expect(second.pdfObjectId).not.toBe(first.pdfObjectId);
      const old = await t.prisma.storedObject.findUniqueOrThrow({ where: { id: first.pdfObjectId } });
      expect(old.deletedAt).not.toBeNull();
      expect(old.wrappedKey).toBe('');
      expect(store.keys()).toHaveLength(1);
      expect((await text(await pdfOf(a.accountId, propertyId, '2025-10'))).replace(/\s+/g, '')).toContain('Photographer'); // may wrap in a narrow column
      expect(await t.prisma.auditLog.count({ where: { action: 'register.generated' } })).toBe(2);
    });

    it('survives parallel generation for the same month', async () => {
      await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Eriksson');
      const results = await Promise.all([generate(), generate(), generate()]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(await t.prisma.policeRegister.count()).toBe(1);
      expect(store.keys()).toHaveLength(1);
      expect(await t.prisma.storedObject.count({ where: { deletedAt: null, kind: 'POLICE_REGISTER_PDF' } })).toBe(1);
    });

    it('two regenerations that overlap each release the file they replaced: no copy is left behind', async () => {
      await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Eriksson');
      await generate().expect(200);
      // Both requests render before either swaps, so both start from the same previous file.
      const renderer = t.app.get(PdfRenderer);
      const render = renderer.render.bind(renderer);
      let waiting: (() => void)[] = [];
      jest.spyOn(renderer, 'render').mockImplementation(async (html) => {
        const out = await render(html);
        await new Promise<void>((go) => {
          waiting.push(go);
          if (waiting.length === 2) {
            waiting.forEach((w) => w());
            waiting = [];
          }
        });
        return out;
      });
      expect((await Promise.all([generate(), generate()])).map((r) => r.status)).toEqual([200, 200]);

      const row = await t.prisma.policeRegister.findFirstOrThrow();
      const live = await t.prisma.storedObject.findMany({ where: { deletedAt: null, kind: 'POLICE_REGISTER_PDF' } });
      expect(live.map((o) => [o.id, o.expiresAt])).toEqual([[row.pdfObjectId, null]]);
      expect(store.keys()).toHaveLength(1);
    });

    it('a previous file that cannot be deleted at once is left due, and the retention job removes it', async () => {
      await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Eriksson');
      await generate().expect(200);
      const first = (await t.prisma.policeRegister.findFirstOrThrow()).pdfObjectId;
      jest.spyOn(t.app.get(StorageService), 'delete').mockRejectedValueOnce(new Error('store down'));
      await generate().expect(200);

      const current = (await t.prisma.policeRegister.findFirstOrThrow()).pdfObjectId;
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: current } })).expiresAt).toBeNull();
      const old = await t.prisma.storedObject.findUniqueOrThrow({ where: { id: first } });
      expect(old.deletedAt).toBeNull();
      expect(old.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now());

      jest.restoreAllMocks();
      await t.app.get(RetentionService).purge(new Date());
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: first } })).deletedAt).not.toBeNull();
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: current } })).deletedAt).toBeNull();
      expect(store.keys()).toHaveLength(1);
    });

    it('a file whose row could not be written is provisional: removed at once, or by the retention job', async () => {
      await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Eriksson');
      const storage = t.app.get(StorageService);
      const put = storage.put.bind(storage);
      const written: string[] = [];
      jest.spyOn(storage, 'put').mockImplementation(async (...args) => {
        expect(args[3]?.expiresAt?.getTime()).toBeGreaterThan(Date.now()); // provisional from the start
        const info = await put(...args);
        written.push(info.id);
        // The row cannot be written, and the immediate clean-up fails too.
        await t.prisma.$executeRawUnsafe(`ALTER TABLE "PoliceRegister" ADD CONSTRAINT test_refuse CHECK (false) NOT VALID`);
        return info;
      });
      jest.spyOn(storage, 'delete').mockRejectedValue(new Error('store down'));
      try {
        expect((await generate()).status).toBe(500);
      } finally {
        await t.prisma.$executeRawUnsafe(`ALTER TABLE "PoliceRegister" DROP CONSTRAINT IF EXISTS test_refuse`);
      }
      jest.restoreAllMocks();
      const orphan = await t.prisma.storedObject.findUniqueOrThrow({ where: { id: written[0] } });
      expect(orphan.deletedAt).toBeNull();
      await t.app.get(RetentionService).purge(new Date(Date.now() + 2 * 3_600_000));
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: written[0] } })).deletedAt).not.toBeNull();
      expect(store.keys()).toHaveLength(0);
    });

    it('refuses a malformed or not-yet-started month', async () => {
      for (const m of ['2025-13', '2025-1', 'abc']) await generate(m).expect(400);
      await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/registers/2025-13/validation`).expect(400);
      const res = await generate('2099-01').expect(422);
      expect(res.body.error.code).toBe('MONTH_NOT_STARTED');
      expect(await t.prisma.policeRegister.count()).toBe(0);
    });
  });

  describe('the month list', () => {
    it('says none, generated or outdated, and Staff see the status only', async () => {
      const now = new Date('2025-10-20T10:00:00Z');
      const { guest } = await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Eriksson');
      await stay(a.accountId, propertyId, '2025-09-04', '2025-09-06', 'Bruno Sept', { guest: { profession: null } });
      const manager = { id: a.users.OWNER_MANAGER.id, accountId: a.accountId, role: 'OWNER_MANAGER' as const };
      const staff = { id: a.users.STAFF.id, accountId: a.accountId, role: 'STAFF' as const };
      const status = async (u: typeof manager | typeof staff) => Object.fromEntries((await svc.list(u as never, propertyId, now)).months.map((m) => [m.month, m.status]));

      expect(await status(manager)).toEqual({ '2025-10': 'none', '2025-09': 'none' });
      await generate('2025-10').expect(200);
      expect(await status(manager)).toEqual({ '2025-10': 'generated', '2025-09': 'none' });

      await t.prisma.guestCheckIn.update({ where: { id: guest!.id }, data: { profession: 'Photographer' } });
      expect(await status(staff)).toEqual({ '2025-10': 'outdated', '2025-09': 'none' });
      await generate('2025-10').expect(200);
      expect(await status(manager)).toEqual({ '2025-10': 'generated', '2025-09': 'none' });

      const detailed = (await svc.list(manager as never, propertyId, now)).months;
      expect(detailed.find((m) => m.month === '2025-09')).toMatchObject({ guests: 1, problems: 1, byKind: { MISSING_FIELD: 1 } });
      expect((await svc.list(staff as never, propertyId, now)).months[0]).toEqual({ month: '2025-10', status: 'generated' });
    });

    it('over HTTP: Staff get the status only, Accountant is refused, another account gets 404', async () => {
      await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Eriksson');
      const m = (await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/registers`).expect(200)).body.months;
      expect(m.every((x: Record<string, unknown>) => 'guests' in x)).toBe(true);
      const s = (await a.as.STAFF.get(`/api/properties/${propertyId}/registers`).expect(200)).body.months;
      expect(s.every((x: Record<string, unknown>) => Object.keys(x).sort().join() === 'month,status')).toBe(true);
      expect(JSON.stringify(s)).not.toMatch(/Eriksson/);
      await a.as.ACCOUNTANT.get(`/api/properties/${propertyId}/registers`).expect(403);
      await b.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/registers`).expect(404);
    });
  });

  describe('reading the PDF', () => {
    it('serves Owner/Manager only, no-store, and audits every read', async () => {
      await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Eriksson');
      await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/registers/2025-10/pdf`).expect(404); // none yet
      await generate().expect(200);
      const url = `/api/properties/${propertyId}/registers/2025-10/pdf`;
      const res = await a.as.OWNER_MANAGER.get(url).buffer(true).parse(binary).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toBe('inline; filename="registre-de-police.pdf"');
      expect(res.headers['x-robots-tag']).toContain('noindex');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await a.as.OWNER_MANAGER.get(url).buffer(true).parse(binary).expect(200);

      const reads = await t.prisma.auditLog.findMany({ where: { action: 'register.read' } });
      expect(reads).toHaveLength(2);
      expect(reads.every((r) => r.actorId === a.users.OWNER_MANAGER.id && r.resourceType === 'PoliceRegister')).toBe(true);

      await a.as.STAFF.get(url).expect(403);
      await a.as.ACCOUNTANT.get(url).expect(403);
      await a.as.ANON.get(url).expect(401);
      await b.as.OWNER_MANAGER.get(url).expect(404);
      expect(await t.prisma.auditLog.count({ where: { action: 'register.read' } })).toBe(2);
    });

    it('fails closed: no audit row, no bytes', async () => {
      await generate().expect(200);
      jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValue(new Error('audit down'));
      const res = await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/registers/2025-10/pdf`).buffer(true).parse(binary);
      expect(res.status).toBe(500);
      expect((res.body as Buffer).subarray(0, 5).toString()).not.toBe('%PDF-');
    });
  });

  describe('another account', () => {
    it('cannot validate or generate for this property, and creates nothing', async () => {
      await stay(a.accountId, propertyId, '2025-10-04', '2025-10-06', 'Anna Eriksson');
      await b.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/registers/2025-10/validation`).expect(404);
      await b.as.OWNER_MANAGER.post(`/api/properties/${propertyId}/registers/2025-10`).expect(404);
      expect(await t.prisma.policeRegister.count()).toBe(0);
      expect(store.keys()).toHaveLength(0);
    });
  });
});

describe('Police register flag (integration)', () => {
  it('answers 404 on every route when POLICE_REGISTER_ENABLED is off, even for a manager', async () => {
    const t = await createTestApp({ env: { POLICE_REGISTER_ENABLED: 'false' } });
    try {
      await resetDatabase(t.prisma, t.redis);
      const a = await seedAccount(t, 'Alpha');
      const id = '11111111-1111-4111-8111-111111111111';
      await a.as.OWNER_MANAGER.get(`/api/properties/${id}/registers`).expect(404);
      await a.as.OWNER_MANAGER.get(`/api/properties/${id}/registers/2025-10/validation`).expect(404);
      await a.as.OWNER_MANAGER.post(`/api/properties/${id}/registers/2025-10`).expect(404);
      await a.as.OWNER_MANAGER.get(`/api/properties/${id}/registers/2025-10/pdf`).expect(404);
    } finally {
      await t.app.close();
    }
  });
});
