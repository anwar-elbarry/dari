import { AuditService } from '../audit/audit.service';
import { MemoryObjectStore } from '../storage/memory-object-store';
import { OBJECT_STORE } from '../storage/object-store';
import { StorageService } from '../storage/storage.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { RetentionProcessor } from './retention.processor';
import { DRAFT_TTL_MS, RetentionService } from './retention.service';

requireDatabase();

const DAY = 86_400_000;

describe('retention (integration)', () => {
  let t: TestApp;
  let retention: RetentionService;
  let storage: StorageService;
  let store: MemoryObjectStore;
  let a: SeededAccount;
  let b: SeededAccount;

  beforeAll(async () => {
    t = await createTestApp({ env: { OPS_ALERT_EMAIL: 'ops@dari.test' } });
    retention = t.app.get(RetentionService);
    storage = t.app.get(StorageService);
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
    // With Redis the hourly worker runs inside the app too; stop it so only the calls below decide when a purge runs.
    try {
      await t.app.get(RetentionProcessor, { strict: false }).worker.close();
    } catch {
      // No Redis configured: there is no worker.
    }
  });
  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(t.prisma, t.redis);
    for (const key of store.keys()) await store.delete(key);
    t.mail.sent.length = 0;
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    await t.prisma.ruleConfig.create({ data: { key: 'retention.id_images_days', value: { days: 30 } } });
  });

  /** A submitted guest with an ID image that expires at `expiresAt`, on a stay that ends `checkoutDaysAgo` days ago. */
  async function guest(acc: SeededAccount, opts: { expiresInDays?: number; checkoutDaysAgo?: number; status?: 'PENDING' | 'SUBMITTED'; createdHoursAgo?: number; noImage?: boolean } = {}) {
    const { expiresInDays = 30, checkoutDaysAgo = 0, status = 'SUBMITTED', createdHoursAgo = 0, noImage = false } = opts;
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: acc.accountId, name: 'Owner', residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({ data: { accountId: acc.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } });
    const booking = await t.prisma.booking.create({
      data: { accountId: acc.accountId, propertyId: property.id, checkIn: new Date(Date.now() - (checkoutDaysAgo + 3) * DAY), checkOut: new Date(Date.now() - checkoutDaysAgo * DAY), source: 'DIRECT' },
    });
    const link = await t.prisma.checkInLink.create({ data: { accountId: acc.accountId, bookingId: booking.id, tokenHash: `h-${Math.random()}`, expiresAt: new Date(Date.now() + DAY), createdBy: 'u', maxGuests: 2 } });
    const image = noImage ? null : await storage.put(acc.accountId, 'ID_IMAGE', Buffer.from(`synthetic image ${Math.random()}`), { expiresAt: new Date(Date.now() + expiresInDays * DAY) });
    const g = await t.prisma.guestCheckIn.create({
      data: {
        accountId: acc.accountId, bookingId: booking.id, propertyId: property.id, linkId: link.id, status,
        guestIndex: status === 'SUBMITTED' ? 1 : null, docImageId: image?.id ?? null, createdAt: new Date(Date.now() - createdHoursAgo * 3_600_000),
        ...(status === 'SUBMITTED' ? { fullName: 'Anna Eriksson', docNumber: 'L898902C3', nationality: 'SWE', profession: 'Engineer', submittedAt: new Date() } : {}),
      },
    });
    return { guest: g, imageId: image?.id ?? null };
  }

  it('deletes images after the window, keeps the structured record, and audits the purge', async () => {
    const { guest: g, imageId } = await guest(a, { expiresInDays: 30, checkoutDaysAgo: 0 });
    const later = new Date(Date.now() + 31 * DAY); // time-shifted: 31 days on

    const result = await retention.purge(later);
    expect(result).toMatchObject({ purged: 1, drafts: 0, failed: 0 });

    const object = await t.prisma.storedObject.findUniqueOrThrow({ where: { id: imageId! } });
    expect(object.deletedAt).not.toBeNull();
    expect(object.wrappedKey).toBe(''); // shredded: a surviving copy in a backup is unreadable
    expect(store.keys()).toHaveLength(0);

    // The structured record stays; only the image is gone.
    const kept = await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: g.id } });
    expect(kept).toMatchObject({ fullName: 'Anna Eriksson', docNumber: 'L898902C3', profession: 'Engineer', status: 'SUBMITTED', docImageId: imageId });

    const audit = await t.prisma.auditLog.findMany({ where: { action: 'retention.purged' } });
    expect(audit.map((r) => [r.accountId, r.actorId, r.resourceType, r.resourceId])).toEqual([[a.accountId, null, 'StoredObject', imageId]]);
    expect(JSON.stringify(audit)).not.toMatch(/Eriksson|L898902C3/);
  });

  it('keeps images that are still inside the window', async () => {
    const { imageId } = await guest(a, { expiresInDays: 30 });
    expect(await retention.purge(new Date(Date.now() + 29 * DAY))).toMatchObject({ purged: 0, failed: 0 });
    expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: imageId! } })).deletedAt).toBeNull();
    expect(store.keys()).toHaveLength(1);
  });

  it('is idempotent: a second run does nothing and writes nothing', async () => {
    await guest(a);
    const later = new Date(Date.now() + 40 * DAY);
    expect((await retention.purge(later)).purged).toBe(1);
    const audits = await t.prisma.auditLog.count({ where: { action: 'retention.purged' } });
    expect(await retention.purge(later)).toEqual({ purged: 0, drafts: 0, failed: 0, overdue: 0 });
    expect(await t.prisma.auditLog.count({ where: { action: 'retention.purged' } })).toBe(audits);
  });

  it('purges every account, and only what is due', async () => {
    const one = await guest(a, { expiresInDays: 10 });
    const two = await guest(b, { expiresInDays: 10 });
    const keep = await guest(b, { expiresInDays: 90 });
    const result = await retention.purge(new Date(Date.now() + 15 * DAY));
    expect(result.purged).toBe(2);
    const live = await t.prisma.storedObject.findMany({ where: { deletedAt: null } });
    expect(live.map((o) => o.id)).toEqual([keep.imageId]);
    expect(one.imageId).not.toBe(two.imageId);
  });

  it('applies a SHORTER retention rule to images already stored', async () => {
    // Stored with a 30-day date, on a stay that ended 12 days ago. Counsel then shortens the window to 10 days.
    const { imageId } = await guest(a, { expiresInDays: 30, checkoutDaysAgo: 12 });
    expect(await retention.purge()).toMatchObject({ purged: 0 }); // 12 < 30
    await t.prisma.ruleConfig.update({ where: { key: 'retention.id_images_days' }, data: { value: { days: 10 } } });
    expect(await retention.purge()).toMatchObject({ purged: 1 });
    expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: imageId! } })).deletedAt).not.toBeNull();
  });

  describe('Fiche PDFs', () => {
    async function fiche(checkoutDaysAgo: number) {
      const { guest: g } = await guest(a, { checkoutDaysAgo });
      const pdf = await storage.put(a.accountId, 'FICHE_PDF', Buffer.from(`%PDF-1.4 stub ${Math.random()}`));
      await t.prisma.ficheDePolice.create({ data: { accountId: a.accountId, guestCheckInId: g.id, pdfObjectId: pdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64) } });
      return pdf.id;
    }
    const setRule = (value: object, validatedBy: string | null) =>
      t.prisma.ruleConfig.upsert({ where: { key: 'retention.fiche_days' }, update: { value, validatedBy }, create: { key: 'retention.fiche_days', value, validatedBy } });
    const deleted = async (id: string) => (await t.prisma.storedObject.findUniqueOrThrow({ where: { id } })).deletedAt !== null;

    it.each([
      ['no rule row', null, null],
      ['a null period (the seeded row)', { days: null }, null],
      ['a period counsel has not validated', { days: 30 }, null],
      ['a malformed period, even validated', { days: '30' }, 'Counsel'],
    ])('keeps them with %s', async (_label, value, validatedBy) => {
      const id = await fiche(400);
      if (value) await setRule(value, validatedBy);
      await retention.purge(new Date(Date.now() + 3650 * DAY));
      expect(await deleted(id)).toBe(false);
      expect(await t.prisma.ficheDePolice.count()).toBe(1);
    });

    it('deletes them once a validated period has passed since checkout, and only then', async () => {
      const old = await fiche(400);
      const recent = await fiche(10);
      await setRule({ days: 365 }, 'Counsel');
      expect(await retention.purge()).toMatchObject({ purged: expect.any(Number), failed: 0 });
      expect(await deleted(old)).toBe(true);
      expect(await deleted(recent)).toBe(false);
      const row = await t.prisma.storedObject.findUniqueOrThrow({ where: { id: old } });
      expect(row.wrappedKey).toBe('');
      const audit = await t.prisma.auditLog.findMany({ where: { action: 'retention.purged', resourceId: old } });
      expect(audit).toHaveLength(1);
    });
  });

  describe('police registers', () => {
    async function register(month: string) {
      const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Owner', residency: 'RESIDENT' } });
      const property = await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } });
      const pdf = await storage.put(a.accountId, 'POLICE_REGISTER_PDF', Buffer.from(`%PDF-1.4 stub ${Math.random()}`));
      const row = await t.prisma.policeRegister.create({ data: { accountId: a.accountId, propertyId: property.id, month, pdfObjectId: pdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64), inputDigest: 'd', guestCount: 0, validation: {}, generatedBy: 'u' } });
      return { row, pdfId: pdf.id };
    }
    const setRule = (value: object, validatedBy: string | null) =>
      t.prisma.ruleConfig.upsert({ where: { key: 'retention.police_register_days' }, update: { value, validatedBy }, create: { key: 'retention.police_register_days', value, validatedBy } });

    it.each([['no rule row', null, null], ['a null period', { days: null }, null], ['a period not validated', { days: 30 }, null]])('keeps every register with %s', async (_l, value, by) => {
      const { pdfId } = await register('2020-01');
      if (value) await setRule(value, by);
      await retention.purge(new Date(Date.now() + 3650 * DAY));
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: pdfId } })).deletedAt).toBeNull();
      expect(await t.prisma.policeRegister.count()).toBe(1);
    });

    it('deletes a register and its PDF once the validated period has passed since the END of its month, and only then', async () => {
      await setRule({ days: 365 }, 'Counsel');
      const now = new Date('2027-06-15T12:00:00Z'); // cutoff 2026-06-15: June 2026 has not ended, May 2026 has
      const old = await register('2026-05');
      const edge = await register('2026-06');
      const recent = await register('2027-03');
      const result = await retention.purge(now);
      expect(result.failed).toBe(0);
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: old.pdfId } })).wrappedKey).toBe(''); // shredded
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: old.pdfId } })).deletedAt).not.toBeNull();
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: edge.pdfId } })).deletedAt).toBeNull();
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: recent.pdfId } })).deletedAt).toBeNull();
      expect((await t.prisma.policeRegister.findMany()).map((r) => r.month).sort()).toEqual(['2026-06', '2027-03']);
      const audit = await t.prisma.auditLog.findMany({ where: { action: 'retention.purged', resourceType: 'PoliceRegister' } });
      expect(audit.map((r) => r.resourceId)).toEqual([old.row.id]);
      expect(await retention.purge(now)).toMatchObject({ purged: 0, failed: 0 }); // idempotent
    });
  });

  describe('abandoned drafts', () => {
    it('removes a draft and its photo after a day, and keeps a fresh one', async () => {
      const old = await guest(a, { status: 'PENDING', createdHoursAgo: 25 });
      const fresh = await guest(b, { status: 'PENDING', createdHoursAgo: 2 });
      const result = await retention.purge();
      expect(result).toMatchObject({ drafts: 1, purged: 1, failed: 0 });
      expect(await t.prisma.guestCheckIn.findUnique({ where: { id: old.guest.id } })).toBeNull();
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: old.imageId! } })).deletedAt).not.toBeNull();
      expect(await t.prisma.guestCheckIn.findUnique({ where: { id: fresh.guest.id } })).not.toBeNull();
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: fresh.imageId! } })).deletedAt).toBeNull();
      expect(DRAFT_TTL_MS).toBe(24 * 3_600_000);
    });

    it('removes a draft that never got a photo, and never removes a submitted guest', async () => {
      const empty = await guest(a, { status: 'PENDING', createdHoursAgo: 30, noImage: true });
      const submitted = await guest(b, { status: 'SUBMITTED', createdHoursAgo: 30 });
      await retention.purge();
      expect(await t.prisma.guestCheckIn.findUnique({ where: { id: empty.guest.id } })).toBeNull();
      expect(await t.prisma.guestCheckIn.findUnique({ where: { id: submitted.guest.id } })).not.toBeNull();
    });
  });

  describe('failures', () => {
    it('keeps going when one object fails, reports it, retries next run, and audits only what was deleted', async () => {
      const one = await guest(a, { expiresInDays: 1 });
      const two = await guest(a, { expiresInDays: 1 });
      const later = new Date(Date.now() + 5 * DAY);
      const original = store.delete.bind(store);
      const failing = jest.spyOn(store, 'delete').mockImplementation(async (key: string) => {
        if (key === (await t.prisma.storedObject.findUniqueOrThrow({ where: { id: one.imageId! } })).key) throw new Error('bucket down');
        return original(key);
      });

      const first = await retention.purge(later);
      expect(first).toMatchObject({ purged: 1, failed: 1 });
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: two.imageId! } })).deletedAt).not.toBeNull();
      // The failed one is already unreadable (key shredded) and still queued for the next run.
      const stuck = await t.prisma.storedObject.findUniqueOrThrow({ where: { id: one.imageId! } });
      expect(stuck).toMatchObject({ deletedAt: null, wrappedKey: '' });
      expect(await t.prisma.auditLog.count({ where: { action: 'retention.purged' } })).toBe(1);

      failing.mockRestore();
      const second = await retention.purge(later);
      expect(second).toMatchObject({ purged: 1, failed: 0, overdue: 0 });
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: one.imageId! } })).deletedAt).not.toBeNull();
      expect(store.keys()).toHaveLength(0);
    });

    it('raises an alert (email with counts only) when a purge fails or is overdue', async () => {
      const { imageId } = await guest(a, { expiresInDays: 1 });
      jest.spyOn(store, 'delete').mockRejectedValue(new Error('bucket down'));
      const result = await retention.purge(new Date(Date.now() + 10 * DAY)); // 9 days overdue

      expect(result).toMatchObject({ failed: 1, overdue: 1 });
      expect(t.mail.sent).toHaveLength(1);
      const mail = t.mail.sent[0];
      expect(mail.to).toBe('ops@dari.test');
      expect(mail.subject).toMatch(/retention/i);
      expect(mail.text).toMatch(/1 object\(s\)/);
      expect(mail.text + mail.subject).not.toMatch(new RegExp(`${imageId}|${a.accountId}|Eriksson|L898902C3`)); // counts only
    });

    it('sends no alert when everything is fine', async () => {
      await guest(a, { expiresInDays: 1 });
      await retention.purge(new Date(Date.now() + 2 * DAY));
      expect(t.mail.sent).toHaveLength(0);
    });

    it('a failing alert email does not fail the purge', async () => {
      await guest(a, { expiresInDays: 1 });
      jest.spyOn(store, 'delete').mockRejectedValue(new Error('bucket down'));
      jest.spyOn(t.mail, 'send').mockRejectedValue(new Error('mail down'));
      await expect(retention.purge(new Date(Date.now() + 5 * DAY))).resolves.toMatchObject({ failed: 1 });
    });
  });

  it('after a purge the manager gets 404 for the image and "no document" in the guest view, but the fields remain', async () => {
    const { guest: g } = await guest(a, { expiresInDays: 1 });
    await a.as.OWNER_MANAGER.get(`/api/guests/${g.id}/document`).expect(200);
    await retention.purge(new Date(Date.now() + 5 * DAY));
    await a.as.OWNER_MANAGER.get(`/api/guests/${g.id}/document`).expect(404);
    const view = (await a.as.OWNER_MANAGER.get(`/api/guests/${g.id}`).expect(200)).body;
    expect(view.hasDocument).toBe(false);
    expect(view.fields.fullName).toBe('Anna Eriksson');
    // Reads of a purged image are not "successful reads": only the one before the purge is on record.
    expect(await t.prisma.auditLog.count({ where: { action: 'guest.document.read' } })).toBe(1);
  });

  it('works through more than one batch over successive runs', async () => {
    for (let i = 0; i < 3; i++) await guest(a, { expiresInDays: 1 });
    const audit = t.app.get(AuditService);
    expect(audit).toBeDefined();
    const later = new Date(Date.now() + 5 * DAY);
    let total = 0;
    for (let run = 0; run < 3 && total < 3; run++) total += (await retention.purge(later)).purged;
    expect(total).toBe(3);
    expect(await t.prisma.storedObject.count({ where: { deletedAt: null } })).toBe(0);
  });
});
