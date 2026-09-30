import sharp from 'sharp';
import { RetentionService } from '../retention/retention.service';
import { StorageService } from '../storage/storage.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { loadChecklistTemplate } from './template-loader';
import { parseTemplateFile } from './template-file';

requireDatabase();

const PDF = '%PDF-1.4\nsynthetic licence document\n%%EOF';

// Synthetic steps for the tests. They are NOT a licensing checklist: the real list comes from counsel.
const template = (o: object = {}) => {
  const parsed = parseTemplateFile({
    city: 'Marrakech',
    steps: [
      { code: 'test_all', position: 1, nameFr: 'Étape pour tous', nameEn: 'Step for all' },
      { code: 'test_riad', position: 2, licenseType: 'RIAD', nameFr: 'Étape riad', nameEn: 'Riad step' },
      { code: 'test_auberge', position: 3, licenseType: 'AUBERGE', nameFr: 'Étape auberge', nameEn: 'Hostel step' },
      { code: 'test_cond', position: 4, condition: 'meals', nameFr: 'Étape conditionnelle', nameEn: 'Conditional step' },
    ],
    ...o,
  });
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.template;
};

describe('licensing checklist (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let propertyId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    propertyId = await newProperty(a, 'Marrakech', 'RIAD');
  });

  async function newProperty(acc: SeededAccount, commune: string, licenseType: 'RIAD' | 'AUBERGE' | 'FURNISHED_APARTMENT') {
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: acc.accountId, name: 'Owner', residency: 'RESIDENT' } });
    return (await t.prisma.property.create({ data: { accountId: acc.accountId, ownerId: owner.id, name: 'P', address: 'x', commune, licenseType } })).id;
  }
  const url = (id = propertyId) => `/api/properties/${id}/checklist`;
  const load = (o: object = {}) => loadChecklistTemplate(t.prisma, template(o));
  const items = async (client = a.as.OWNER_MANAGER, id = propertyId) => (await client.get(url(id)).expect(200)).body as { covered: boolean; validated: boolean; progress: { done: number; total: number }; items: Record<string, unknown>[] };
  const itemId = async (code: string) => ((await items()).items.find((i) => i.code === code) as { id: string }).id;

  describe('template loading', () => {
    it('creates, updates and reports unlisted steps without removing them', async () => {
      expect(await load()).toEqual({ created: 4, updated: 0, unlisted: [] });
      expect(await load()).toEqual({ created: 0, updated: 4, unlisted: [] });
      const fewer = template({ steps: [{ code: 'test_all', position: 1, nameFr: 'Étape pour tous', nameEn: 'Step for all' }] });
      expect(await loadChecklistTemplate(t.prisma, fewer)).toEqual({ created: 0, updated: 1, unlisted: ['test_auberge', 'test_cond', 'test_riad'] });
      expect(await t.prisma.checklistTemplateStep.count()).toBe(4);
    });

    it('a step edited without a validation becomes unvalidated again', async () => {
      await load({ validatedBy: 'Counsel', validatedAt: '2026-10-31' });
      expect(await t.prisma.checklistTemplateStep.count({ where: { validatedBy: 'Counsel' } })).toBe(4);
      await load();
      expect(await t.prisma.checklistTemplateStep.count({ where: { validatedBy: null } })).toBe(4);
    });
  });

  describe('listing', () => {
    it('with no template the city is not covered and the list is empty (nothing is invented)', async () => {
      expect(await items()).toEqual({ covered: false, validated: false, progress: { done: 0, total: 0 }, items: [] });
    });

    it('copies the steps that fit the property: its licence type and unrestricted ones, conditions included', async () => {
      await load();
      const r = await items();
      expect(r.covered).toBe(true);
      expect(r.items.map((i) => i.code)).toEqual(['test_all', 'test_riad', 'test_cond']);
      expect(r.items[0]).toMatchObject({ status: 'TODO', dueDate: null, note: null, hasDocument: false });
      expect(r.progress).toEqual({ done: 0, total: 3 });
    });

    it('matches the city without regard to case, and another city is not covered', async () => {
      await load();
      const lower = await newProperty(a, ' marrakech ', 'RIAD');
      expect((await items(a.as.OWNER_MANAGER, lower)).items).toHaveLength(3);
      const other = await newProperty(a, 'Fès', 'RIAD');
      expect(await items(a.as.OWNER_MANAGER, other)).toMatchObject({ covered: false, items: [] });
    });

    it('is validated only when every step of the list is validated', async () => {
      await load();
      expect((await items()).validated).toBe(false);
      await load({ validatedBy: 'Counsel', validatedAt: '2026-10-31' });
      expect((await items()).validated).toBe(true);
    });

    it('parallel reads create each copy once', async () => {
      await load();
      await Promise.all([1, 2, 3, 4, 5].map(() => a.as.OWNER_MANAGER.get(url()).expect(200)));
      expect(await t.prisma.checklistItem.count({ where: { propertyId } })).toBe(3);
    });

    it('changing the licence type drops untouched copies and keeps the ones somebody worked on', async () => {
      await load();
      const riad = await itemId('test_riad');
      await items();
      await a.as.OWNER_MANAGER.patch(`${url()}/${await itemId('test_cond')}`, { note: 'checked' }).expect(200);
      await t.prisma.property.update({ where: { id: propertyId }, data: { licenseType: 'AUBERGE' } });
      const codes = (await items()).items.map((i) => i.code);
      expect(codes).toEqual(['test_all', 'test_auberge', 'test_cond']);
      expect(await t.prisma.checklistItem.count({ where: { id: riad } })).toBe(0);
    });

    it('progress leaves out the steps marked not applicable', async () => {
      await load();
      await a.as.OWNER_MANAGER.patch(`${url()}/${await itemId('test_all')}`, { status: 'DONE' }).expect(200);
      await a.as.OWNER_MANAGER.patch(`${url()}/${await itemId('test_cond')}`, { status: 'NOT_APPLICABLE' }).expect(200);
      expect((await items()).progress).toEqual({ done: 1, total: 2 });
    });

    it('Staff see the steps and their status only', async () => {
      await load();
      const id = await itemId('test_all');
      await a.as.OWNER_MANAGER.patch(`${url()}/${id}`, { status: 'IN_PROGRESS', note: 'private note', dueDate: '2026-12-01' }).expect(200);
      await a.as.OWNER_MANAGER.upload(`${url()}/${id}/document`, PDF, {}, 'l.pdf').expect(200);
      const r = await items(a.as.STAFF);
      expect(r.items[0]).toEqual({ id, code: 'test_all', nameFr: 'Étape pour tous', nameEn: 'Step for all', condition: null, position: 1, status: 'IN_PROGRESS' });
      expect(JSON.stringify(r)).not.toMatch(/private note|dueDate|hasDocument|note/);
    });

    it('another account gets 404 and the Accountant is refused', async () => {
      await b.as.OWNER_MANAGER.get(url()).expect(404);
      await a.as.ACCOUNTANT.get(url()).expect(403);
    });
  });

  describe('updating', () => {
    beforeEach(async () => {
      await load();
    });

    it('changes the status, due date and note, audits ids only, and clears with null', async () => {
      const id = await itemId('test_all');
      const res = await a.as.OWNER_MANAGER.patch(`${url()}/${id}`, { status: 'DONE', dueDate: '2026-11-15', note: '  Titre foncier reçu  ' }).expect(200);
      expect(res.body).toMatchObject({ status: 'DONE', dueDate: '2026-11-15', note: 'Titre foncier reçu' });
      const row = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'checklist.updated' } });
      expect(row).toMatchObject({ actorId: a.users.OWNER_MANAGER.id, resourceType: 'ChecklistItem', resourceId: id });
      expect(JSON.stringify(row)).not.toMatch(/foncier|DONE|2026-11-15/);
      const cleared = await a.as.OWNER_MANAGER.patch(`${url()}/${id}`, { dueDate: null, note: '' }).expect(200);
      expect(cleared.body).toMatchObject({ dueDate: null, note: null });
    });

    it.each([[{}], [{ status: 'FINISHED' }], [{ dueDate: '2026-13-40' }], [{ dueDate: '2026-02-30' }], [{ dueDate: '01/12/2026' }], [{ note: 'x'.repeat(501) }], [{ accountId: 'x' }], [{ status: 'DONE', extra: 1 }]])('refuses %j', async (body) => {
      await a.as.OWNER_MANAGER.patch(`${url()}/${await itemId('test_all')}`, body).expect(400);
    });

    it('Staff and the Accountant cannot write; another account gets 404', async () => {
      const id = await itemId('test_all');
      await a.as.STAFF.patch(`${url()}/${id}`, { status: 'DONE' }).expect(403);
      await a.as.ACCOUNTANT.patch(`${url()}/${id}`, { status: 'DONE' }).expect(403);
      await b.as.OWNER_MANAGER.patch(`${url(await newProperty(b, 'Marrakech', 'RIAD'))}/${id}`, { status: 'DONE' }).expect(404);
      await b.as.OWNER_MANAGER.patch(`${url()}/${id}`, { status: 'DONE' }).expect(404);
      expect((await t.prisma.checklistItem.findUniqueOrThrow({ where: { id } })).status).toBe('TODO');
    });

    it('an item of another property is not reachable through this one', async () => {
      const id = await itemId('test_all');
      const second = await newProperty(a, 'Marrakech', 'RIAD');
      await a.as.OWNER_MANAGER.patch(`${url(second)}/${id}`, { status: 'DONE' }).expect(404);
    });
  });

  describe('documents', () => {
    let id: string;
    beforeEach(async () => {
      await load();
      id = await itemId('test_all');
    });
    const attach = (file: string | Buffer = PDF, name = 'licence.pdf', client = a.as.OWNER_MANAGER) => client.upload(`${url()}/${id}/document`, file, {}, name);
    const storedRow = async () => {
      const item = await t.prisma.checklistItem.findUniqueOrThrow({ where: { id } });
      return item.documentObjectId ? t.prisma.storedObject.findUniqueOrThrow({ where: { id: item.documentObjectId } }) : null;
    };

    it('stores the file encrypted, permanent, and reads it back after an audit row', async () => {
      const res = await attach().expect(200);
      expect(res.body).toMatchObject({ hasDocument: true });
      const stored = await storedRow();
      expect(stored).toMatchObject({ kind: 'LICENSE_DOCUMENT', expiresAt: null, deletedAt: null });

      const read = await a.as.OWNER_MANAGER.get(`${url()}/${id}/document`).buffer(true).expect(200);
      expect(read.headers['content-type']).toContain('application/pdf');
      expect(read.headers['content-disposition']).toMatch(/^attachment/);
      expect(read.headers['cache-control']).toBe('no-store');
      expect(read.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.from(read.body).toString()).toBe(PDF);
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'license_document.read' } });
      expect(audit).toMatchObject({ actorId: a.users.OWNER_MANAGER.id, resourceType: 'ChecklistItem', resourceId: id });
    });

    it('re-encodes a photo to JPEG and drops its metadata', async () => {
      const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#336699' } }).png().toBuffer();
      await attach(png, 'scan.png').expect(200);
      const read = await a.as.OWNER_MANAGER.get(`${url()}/${id}/document`).buffer(true).expect(200);
      expect(read.headers['content-type']).toContain('image/jpeg');
      expect(Buffer.from(read.body).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    });

    it.each([['text', 'not a document at all'], ['HTML', '<html><script>alert(1)</script></html>']])('refuses %s whatever the name says', async (_n, content) => {
      const res = await attach(content, 'licence.pdf').expect(422);
      expect(res.body.error.code).toBe('DOCUMENT_INVALID');
      expect(await storedRow()).toBeNull();
      expect(await t.prisma.storedObject.count()).toBe(0);
    });

    it('refuses a file over 8 MB at the upload limit, before it is held or stored', async () => {
      await attach(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(8 * 1024 * 1024)])).expect(413);
      expect(await t.prisma.storedObject.count()).toBe(0);
    });

    it('refuses a request with no file', async () => {
      const res = await a.as.OWNER_MANAGER.post(`${url()}/${id}/document`, {}).expect(400);
      expect(res.body.error.code).toBe('FILE_REQUIRED');
    });

    it('replacing shreds the previous file and leaves exactly one live', async () => {
      await attach().expect(200);
      const first = await storedRow();
      await attach(PDF.replace('synthetic', 'second')).expect(200);
      const second = await storedRow();
      expect(second!.id).not.toBe(first!.id);
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: first!.id } })).deletedAt).not.toBeNull();
      expect(await t.prisma.storedObject.count({ where: { deletedAt: null } })).toBe(1);
      await expect(t.app.get(StorageService).read(a.accountId, first!.id, { actorId: null, action: 'license_document.read', resourceType: 'ChecklistItem', resourceId: id })).rejects.toBeDefined();
    });

    it('parallel uploads leave one live file and no orphan', async () => {
      await attach().expect(200);
      const results = await Promise.all([1, 2, 3].map((n) => attach(PDF.replace('synthetic', `parallel ${n}`))));
      expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
      expect(results.some((r) => r.status === 200)).toBe(true);
      const live = await t.prisma.storedObject.findMany({ where: { deletedAt: null } });
      const pointed = (await storedRow())!;
      // Everything not pointed at is either gone or already due, so the retention job reaches it.
      for (const o of live) if (o.id !== pointed.id) expect(o.expiresAt && o.expiresAt <= new Date()).toBeTruthy();
    });

    it('deleting detaches and shreds; reading afterwards is 404; a second delete is 404', async () => {
      await attach().expect(200);
      const stored = await storedRow();
      await a.as.OWNER_MANAGER.delete(`${url()}/${id}/document`).expect(204);
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: stored!.id } })).deletedAt).not.toBeNull();
      await a.as.OWNER_MANAGER.get(`${url()}/${id}/document`).expect(404);
      await a.as.OWNER_MANAGER.delete(`${url()}/${id}/document`).expect(404);
      expect(await t.prisma.auditLog.count({ where: { action: 'storage.object.deleted', resourceId: id } })).toBe(1);
    });

    it('Staff and the Accountant can neither attach, read nor delete; another account gets 404', async () => {
      await attach().expect(200);
      for (const who of [a.as.STAFF, a.as.ACCOUNTANT]) {
        await attach(PDF, 'x.pdf', who).expect(403);
        await who.get(`${url()}/${id}/document`).expect(403);
        await who.delete(`${url()}/${id}/document`).expect(403);
      }
      await b.as.OWNER_MANAGER.get(`${url()}/${id}/document`).expect(404);
      expect(await t.prisma.auditLog.count({ where: { action: 'license_document.read' } })).toBe(0);
    });

    it('no audit row, no bytes: a failing audit write stops the read', async () => {
      await attach().expect(200);
      const spy = jest.spyOn(t.prisma.auditLog, 'create').mockRejectedValueOnce(new Error('audit down'));
      const res = await a.as.OWNER_MANAGER.get(`${url()}/${id}/document`);
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body) + res.text).not.toContain('synthetic licence document');
    });
  });

  describe('retention', () => {
    it('keeps documents until counsel has validated a period, then purges them by age and clears the pointer', async () => {
      await load();
      const id = await itemId('test_all');
      await a.as.OWNER_MANAGER.upload(`${url()}/${id}/document`, PDF, {}, 'l.pdf').expect(200);
      const retention = t.app.get(RetentionService);
      const later = new Date(Date.now() + 3000 * 86_400_000);

      await retention.purge(later); // no rule: nothing is deleted
      expect((await t.prisma.checklistItem.findUniqueOrThrow({ where: { id } })).documentObjectId).not.toBeNull();

      const rule = (data: object) => t.prisma.ruleConfig.upsert({ where: { key: 'retention.license_documents_days' }, update: data, create: { key: 'retention.license_documents_days', value: { days: 1825 }, ...data } });
      await rule({ value: { days: 1825 } });
      await retention.purge(later); // a period nobody validated: still nothing
      expect((await t.prisma.checklistItem.findUniqueOrThrow({ where: { id } })).documentObjectId).not.toBeNull();

      await rule({ validatedBy: 'Counsel', validatedAt: new Date() });
      await retention.purge(new Date(Date.now() + 1000 * 86_400_000)); // younger than the period
      expect((await t.prisma.checklistItem.findUniqueOrThrow({ where: { id } })).documentObjectId).not.toBeNull();

      await retention.purge(later);
      expect((await t.prisma.checklistItem.findUniqueOrThrow({ where: { id } })).documentObjectId).toBeNull();
      expect(await t.prisma.storedObject.count({ where: { kind: 'LICENSE_DOCUMENT', deletedAt: null } })).toBe(0);
      expect(await t.prisma.auditLog.count({ where: { action: 'retention.purged', resourceType: 'ChecklistItem', resourceId: id } })).toBe(1);
      // the checklist item itself stays, with its status
      expect((await items()).items).toHaveLength(3);
    });
  });
});
