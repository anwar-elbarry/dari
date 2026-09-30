import { Logger } from '@nestjs/common';
import { chromium } from 'playwright-core';
import request from 'supertest';
import sharp from 'sharp';
import { RedactingLogger } from '../common/redacting-logger';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../common/csrf.guard';
import { RetentionService } from '../retention/retention.service';
import { MemoryObjectStore } from '../storage/memory-object-store';
import { OBJECT_STORE } from '../storage/object-store';
import { StorageService } from '../storage/storage.service';
import { seedTaxRules } from '../test/tax-fixtures';
import { MessagingService } from '../messaging/messaging.service';
import { sign } from '../messaging/signature';
import { StubWhatsAppProvider, WHATSAPP_PROVIDER } from '../messaging/whatsapp.provider';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { mapWorkerResponse, OcrClient } from './ocr.client';
import { PdfRenderer } from './pdf-renderer';

requireDatabase();

/**
 * Rule from CLAUDE.md: logs carry ids only. Distinctive fake personal data goes through every guest and manager
 * route, including failing paths whose exceptions quote that data, and none of it may reach a log line or an
 * audit row. (Every value below is invented.)
 */
const PII = {
  name: 'Zaynab Quenneville',
  surname: 'QUENNEVILLE',
  docNumber: 'QX7654321',
  dob: '1988-03-14',
  stamp: 'ZZSTAMP777',
  city: 'Vaugirard-sur-Mer',
  next: 'Ouarzazate-Nord',
  job: 'Hydrogéologue',
  correction: 'Ingénieure-Cartographe',
};
const DAY = 86_400_000;

describe('no personal data in logs or audit rows (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let output = '';
  let bookingId: string;
  let consentId: string;
  let store: MemoryObjectStore;

  beforeAll(async () => {
    t = await createTestApp({ logger: new RedactingLogger(), env: { OPS_ALERT_EMAIL: 'ops@dari.test', WHATSAPP_APP_SECRET: 'app-secret-for-logging-0123456789', WHATSAPP_VERIFY_TOKEN: 'verify-token-for-logging-0123456789' } });
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await t.app.close();
  });

  /** Fresh capture of stdout and stderr for each test (restoreAllMocks detaches the previous one). */
  function capture() {
    output = '';
    for (const stream of [process.stdout, process.stderr]) {
      jest.spyOn(stream, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        output += String(chunk);
        return true;
      }) as typeof process.stdout.write);
    }
    // Canary: if this line is not captured, every "not in the logs" assertion below would be meaningless.
    new Logger('Canary').log('canary-line-capture-works');
    expect(output).toContain('canary-line-capture-works');
  }

  beforeEach(async () => {
    jest.restoreAllMocks();
    capture();
    await resetDatabase(t.prisma, t.redis);
    for (const key of store.keys()) await store.delete(key);
    a = await seedAccount(t, 'Alpha');
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Owner', residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } });
    bookingId = (await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId: property.id, checkIn: new Date(Date.now() + 10 * DAY), checkOut: new Date(Date.now() + 13 * DAY), source: 'DIRECT' } })).id;
    await t.prisma.ruleConfig.createMany({ data: [{ key: 'retention.id_images_days', value: { days: 30 } }, { key: 'checkin.link_grace_hours', value: { hours: 48 } }] });
    consentId = (await t.prisma.consentText.create({ data: { version: 'v1', locale: 'fr', body: 'Je consens.', approvedBy: 'c', approvedAt: new Date(Date.now() - DAY) } })).id;
    // The OCR "reads" the fake person, so the suggestion flow carries the PII too.
    jest.spyOn(t.app.get(OcrClient), 'extract').mockResolvedValue(
      mapWorkerResponse({ status: 'ok', fields: { document_type: 'P', surname: PII.surname, given_names: 'ZAYNAB', document_number: PII.docNumber, nationality: 'FRA', birth_date: PII.dob, expiry_date: '2031-01-01' }, flagged: [], corrected: [], unverified: [], confidence: 1 }),
    );
  });

  const photo = () => sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 200, g: 200, b: 200 } } }).jpeg().toBuffer();
  const form = (over: Record<string, unknown> = {}) => ({
    docType: 'PASSPORT', fullName: PII.name, nationality: 'FRA', docNumber: PII.docNumber, dob: PII.dob, declaredMoroccanNationality: false,
    entryStampNumber: PII.stamp, cityOfOrigin: PII.city, nextDestination: PII.next, profession: PII.job, consent: true, ...over,
  });

  /** Everything that must not appear anywhere in the output or the audit trail. */
  async function expectClean(extra: string[] = []) {
    const audit = JSON.stringify(await t.prisma.auditLog.findMany());
    for (const value of [...Object.values(PII), ...extra]) {
      expect({ value, inLogs: output.includes(value) }).toEqual({ value, inLogs: false });
      expect({ value, inAudit: audit.includes(value) }).toEqual({ value, inAudit: false });
    }
  }

  it('the full guest flow and the manager routes leave no personal data or token in the logs', async () => {
    const link = (await a.as.OWNER_MANAGER.post(`/api/bookings/${bookingId}/checkin-links`, { maxGuests: 2 }).expect(201)).body as { token: string; url: string };
    const server = t.app.getHttpServer();
    const guest = (req: request.Test) => req.set(CSRF_HEADER, CSRF_HEADER_VALUE).set('X-Checkin-Token', link.token);

    await request(server).get('/api/checkin').set('X-Checkin-Token', link.token).expect(200);
    const up = await guest(request(server).post('/api/checkin/document')).attach('file', await photo(), { filename: `${PII.name}.jpg`, contentType: 'image/jpeg' }).expect(200);
    const draftId = up.body.draftId as string;

    // Failing submits that carry the PII: every validation error path.
    await guest(request(server).post('/api/checkin/submit')).send({ ...form({ profession: '' }), draftId, consentTextId: consentId }).expect(400);
    await guest(request(server).post('/api/checkin/submit')).send({ ...form({ dob: '2999-01-01' }), draftId, consentTextId: consentId }).expect(422);
    await guest(request(server).post('/api/checkin/submit')).send({ ...form(), draftId, consentTextId: consentId, extraField: PII.name }).expect(400);
    await guest(request(server).post('/api/checkin/submit')).send({ ...form({ fullName: `${PII.name}<script>` }), draftId, consentTextId: consentId }).expect(400);
    await guest(request(server).post('/api/checkin/submit')).set('Content-Type', 'application/json').send(`{"fullName": "${PII.name}", broken`).expect(400);
    // A file that is not an image, named after the person and carrying their number.
    await guest(request(server).post('/api/checkin/document')).attach('file', Buffer.from(`%PDF ${PII.name} ${PII.docNumber}`), { filename: `${PII.docNumber}.pdf`, contentType: 'application/pdf' }).expect(422);
    await guest(request(server).post('/api/checkin/submit')).send({ ...form(), draftId, consentTextId: consentId }).expect(200);

    // Manager side.
    const guestId = draftId;
    await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}`).expect(200);
    await a.as.OWNER_MANAGER.get(`/api/guests/${guestId}/document`).expect(200);
    await a.as.OWNER_MANAGER.patch(`/api/guests/${guestId}`, { profession: PII.correction, verified: true }).expect(200);
    await a.as.OWNER_MANAGER.patch(`/api/guests/${guestId}`, { profession: `${PII.correction}<b>` }).expect(400);
    await a.as.OWNER_MANAGER.patch(`/api/guests/${guestId}`, { dob: '2999-01-01', fullName: PII.name }).expect(422);
    await a.as.STAFF.get(`/api/guests/${guestId}`).expect(200);
    await a.as.STAFF.get(`/api/guests/${guestId}/document`).expect(403);
    const property = await t.prisma.property.findFirstOrThrow();
    await a.as.OWNER_MANAGER.get(`/api/properties/${property.id}/arrivals`).expect(200);
    await a.as.OWNER_MANAGER.get(`/api/bookings/${bookingId}/checkin-links`).expect(200);

    await expectClean([link.token]);
  });

  it('failing paths whose exceptions quote personal data: only the error type is logged', async () => {
    const link = (await a.as.OWNER_MANAGER.post(`/api/bookings/${bookingId}/checkin-links`, {}).expect(201)).body as { token: string };
    const server = t.app.getHttpServer();
    const guest = (req: request.Test) => req.set(CSRF_HEADER, CSRF_HEADER_VALUE).set('X-Checkin-Token', link.token);

    // Storage fails while a guest uploads: a 500 whose message names the person.
    const put = jest.spyOn(t.app.get(StorageService), 'put').mockRejectedValueOnce(new Error(`write failed for ${PII.name} (${PII.docNumber}) ${PII.dob}`));
    const res = await guest(request(server).post('/api/checkin/document')).attach('file', await photo(), 'p.jpg');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(PII.name);
    expect(put).toHaveBeenCalled();
    expect(output).toContain('HttpException'); // it was logged, by type and stack only
    put.mockRestore();

    // The OCR worker fails with a message that quotes the person (the client must not log it). The stub from beforeEach
    // is dropped so the real client runs, and the failing fetch is installed AFTER the restore (restoring resets jest.fn mocks).
    jest.restoreAllMocks();
    const captured = output;
    capture();
    output = captured + output;
    const realFetch = global.fetch;
    const failingFetch = jest.fn().mockRejectedValue(new Error(`connect ECONNRESET while reading ${PII.name} ${PII.docNumber}`));
    global.fetch = failingFetch as unknown as typeof fetch;
    const ocr = new OcrClient({ ...t.config, OCR_SERVICE_URL: 'http://ocr.invalid:8001', OCR_SHARED_SECRET: 's'.repeat(32) });
    expect((await ocr.extract(Buffer.from('x'))).status).toBe('unavailable');
    expect(failingFetch).toHaveBeenCalledTimes(1); // the failure really happened inside the client
    expect(output).toContain('OCR worker unreachable'); // and it was logged, by kind only
    global.fetch = realFetch;

    // The PDF renderer fails (its message would quote the page), on submit and on regenerate.
    // The real renderer runs; the browser itself fails with a message that quotes the page. (Close the browser an earlier test
    // started, or the renderer would simply reuse it.)
    await t.app.get(PdfRenderer).onModuleDestroy();
    jest.spyOn(chromium, 'launch').mockRejectedValue(new Error(`browserType.launch failed: <td>${PII.name}</td> ${PII.docNumber}`));
    jest.spyOn(t.app.get(OcrClient), 'extract').mockResolvedValue(mapWorkerResponse(null));
    const draftId = (await guest(request(server).post('/api/checkin/document')).attach('file', await photo(), 'p.jpg').expect(200)).body.draftId as string;
    await guest(request(server).post('/api/checkin/submit')).send({ ...form(), draftId, consentTextId: consentId }).expect(200);
    await new Promise((r) => setTimeout(r, 300)); // the background generation fails and is logged
    await a.as.OWNER_MANAGER.post(`/api/guests/${draftId}/fiche/regenerate`).expect(503);
    expect(output).toContain('Fiche generation failed'); // logged, with the guest id and the error type
    expect(output).toContain('Chromium could not be started'); // and the renderer says so, without the browser's message

    // Retention cannot delete: the storage error quotes the person; an ops mail is sent with counts only.
    const guestRow = await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: draftId } });
    await t.prisma.storedObject.update({ where: { id: guestRow.docImageId! }, data: { expiresAt: new Date(Date.now() - 3 * DAY) } });
    jest.spyOn(store, 'delete').mockRejectedValue(new Error(`bucket refused deleting ${PII.name}.jpg (${PII.docNumber})`));
    const result = await t.app.get(RetentionService).purge();
    expect(result.failed).toBeGreaterThan(0);
    expect(output).toContain('Retention');
    expect(t.mail.sent.length).toBeGreaterThan(0);
    for (const mail of t.mail.sent) for (const value of Object.values(PII)) expect(`${mail.subject}\n${mail.text}`).not.toContain(value);

    await expectClean([link.token]);
  });

  it('the guest link token never appears in a log line, a response or an audit row after creation', async () => {
    const link = (await a.as.OWNER_MANAGER.post(`/api/bookings/${bookingId}/checkin-links`, {}).expect(201)).body as { token: string; id: string };
    const server = t.app.getHttpServer();
    await request(server).get('/api/checkin').set('X-Checkin-Token', link.token).expect(200);
    await request(server).get('/api/checkin').set('X-Checkin-Token', `${link.token.slice(0, -1)}_`).expect(404);
    await a.as.OWNER_MANAGER.post(`/api/checkin-links/${link.id}/resend`).expect(201);
    await a.as.OWNER_MANAGER.delete(`/api/checkin-links/${link.id}`).expect(204);
    const listing = await a.as.OWNER_MANAGER.get(`/api/bookings/${bookingId}/checkin-links`).expect(200);
    expect(JSON.stringify(listing.body)).not.toContain(link.token);
    await expectClean([link.token, link.token.slice(0, 20)]);
  });
  it('the register routes, including a renderer or storage failure that quotes the guests, leave no personal data in the logs', async () => {
    const property = await t.prisma.property.findFirstOrThrow();
    const stay = await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId: property.id, checkIn: new Date('2025-10-04'), checkOut: new Date('2025-10-06'), source: 'DIRECT' } });
    const link = await t.prisma.checkInLink.create({ data: { accountId: a.accountId, bookingId: stay.id, tokenHash: 'reg-log', expiresAt: new Date(Date.now() + DAY), createdBy: 'u', maxGuests: 1 } });
    await t.prisma.guestCheckIn.create({
      data: {
        accountId: a.accountId, bookingId: stay.id, propertyId: property.id, linkId: link.id, guestIndex: 1, status: 'SUBMITTED', docType: 'PASSPORT', fullName: PII.name, nationality: 'FRA', docNumber: PII.docNumber,
        dob: new Date(PII.dob), entryStampNumber: PII.stamp, cityOfOrigin: PII.city, nextDestination: PII.next, profession: PII.job, submittedAt: new Date(),
      },
    });
    const base = `/api/properties/${property.id}/registers`;
    const render = jest.spyOn(t.app.get(PdfRenderer), 'render').mockResolvedValue(Buffer.from('%PDF-1.4 stub'));

    await a.as.OWNER_MANAGER.get(base).expect(200);
    await a.as.OWNER_MANAGER.get(`${base}/2025-10/validation`).expect(200);
    await a.as.OWNER_MANAGER.post(`${base}/2025-10`).expect(200);
    await a.as.OWNER_MANAGER.get(`${base}/2025-10/pdf`).expect(200);
    await a.as.STAFF.get(base).expect(200);
    await a.as.STAFF.get(`${base}/2025-10/pdf`).expect(403);
    await a.as.OWNER_MANAGER.get(`${base}/${PII.name}`).expect(404);
    await a.as.OWNER_MANAGER.get(`${base}/${PII.docNumber}/pdf`).expect(400);

    // The renderer and the store fail with messages that quote the guests: a 500, and only the type is logged.
    render.mockRejectedValueOnce(new Error(`render failed for ${PII.name} ${PII.docNumber} ${PII.city}`));
    expect((await a.as.OWNER_MANAGER.post(`${base}/2025-10`)).status).toBe(500);
    jest.spyOn(t.app.get(StorageService), 'put').mockRejectedValueOnce(new Error(`write failed for ${PII.name} (${PII.docNumber}) ${PII.dob}`));
    expect((await a.as.OWNER_MANAGER.post(`${base}/2025-10`)).status).toBe(500);

    await expectClean();
  });
  it('the share routes leave no token, recipient label or personal data in the logs or the audit trail', async () => {
    const property = await t.prisma.property.findFirstOrThrow();
    const stay = await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId: property.id, checkIn: new Date('2025-10-04'), checkOut: new Date('2025-10-06'), source: 'DIRECT' } });
    const link = await t.prisma.checkInLink.create({ data: { accountId: a.accountId, bookingId: stay.id, tokenHash: 'share-log', expiresAt: new Date(Date.now() + DAY), createdBy: 'u', maxGuests: 1 } });
    const guest = await t.prisma.guestCheckIn.create({
      data: { accountId: a.accountId, bookingId: stay.id, propertyId: property.id, linkId: link.id, guestIndex: 1, status: 'SUBMITTED', fullName: PII.name, docNumber: PII.docNumber, profession: PII.job, submittedAt: new Date() },
    });
    const pdf = await t.app.get(StorageService).put(a.accountId, 'FICHE_PDF', Buffer.from('%PDF-1.4 stub'));
    await t.prisma.ficheDePolice.create({ data: { accountId: a.accountId, guestCheckInId: guest.id, pdfObjectId: pdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64) } });
    const label = `Commissaire ${PII.surname}`;
    const server = t.app.getHttpServer();

    const created = (await a.as.OWNER_MANAGER.post('/api/shares', { resourceType: 'FICHE_DE_POLICE', guestId: guest.id, expiresInHours: 24, recipientLabel: label }).expect(201)).body as { id: string; token: string };
    await a.as.OWNER_MANAGER.post('/api/shares', { resourceType: 'FICHE_DE_POLICE', guestId: guest.id, expiresInHours: 24, recipientLabel: `${label}<script>` }).expect(400);
    await a.as.OWNER_MANAGER.get('/api/shares').expect(200);
    await request(server).get('/api/share').set('X-Share-Token', created.token).set('User-Agent', `UA ${PII.name}`).expect(200);
    // The token in every wrong place: query, path, cookie. All refused, none logged.
    await request(server).get(`/api/share?token=${created.token}`).expect(404);
    await request(server).get(`/api/share/${created.token}`).expect(404);
    await request(server).get('/api/share').set('Cookie', `t=${created.token}`).expect(404);
    await a.as.OWNER_MANAGER.get(`/api/shares/${created.id}/access`).expect(200);
    await a.as.OWNER_MANAGER.delete(`/api/shares/${created.id}`).expect(204);
    await request(server).get('/api/share').set('X-Share-Token', created.token).expect(404);
    // A storage failure whose message quotes the guest: a 500, only the type is logged.
    const again = (await a.as.OWNER_MANAGER.post('/api/shares', { resourceType: 'FICHE_DE_POLICE', guestId: guest.id, expiresInHours: 24, recipientLabel: label }).expect(201)).body as { token: string };
    jest.spyOn(t.app.get(StorageService), 'read').mockRejectedValueOnce(new Error(`read failed for ${PII.name} ${PII.docNumber}`));
    expect((await request(server).get('/api/share').set('X-Share-Token', again.token)).status).toBe(500);

    expect(output).not.toContain(label);
    expect(JSON.stringify(await t.prisma.auditLog.findMany())).not.toContain(PII.surname);
    await expectClean([created.token, again.token]);
  });
  it('the tax routes, including a failure that quotes the owner, leave no owner data or amounts in the logs or the audit trail', async () => {
    await seedTaxRules(t.prisma);
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: PII.name, taxId: 'TAXID-QX-99', residency: 'MRE', bankAccountType: 'CONVERTIBLE_DIRHAM' } });
    const property = await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad taxé', address: PII.city, commune: 'Marrakech', licenseType: 'RIAD' } });
    const stay = await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId: property.id, checkIn: new Date('2026-03-04'), checkOut: new Date('2026-03-06'), source: 'DIRECT', nightlyRevenue: '4242424.24' } });
    const base = `/api/properties/${property.id}/tax-reports`;
    const render = jest.spyOn(t.app.get(PdfRenderer), 'render').mockResolvedValue(Buffer.from('%PDF-1.4 stub'));

    await a.as.OWNER_MANAGER.get(base).expect(200);
    await a.as.OWNER_MANAGER.get(`${base}/2026-03/missing`).expect(200);
    const report = (await a.as.OWNER_MANAGER.post(`${base}/2026-03`).expect(200)).body as { id: string };
    await a.as.OWNER_MANAGER.get(`/api/tax/reports/${report.id}`).expect(200);
    await a.as.OWNER_MANAGER.get('/api/tax/reports').expect(200);
    await a.as.OWNER_MANAGER.get('/api/tax/rules').expect(200);
    await a.as.ACCOUNTANT.get(`/api/tax/reports/${report.id}/pdf`).expect(200);
    await a.as.ACCOUNTANT.get(`/api/tax/reports/${report.id}/xlsx`).expect(200);
    await a.as.OWNER_MANAGER.patch(`/api/bookings/${stay.id}/amounts`, { addonRevenue: '9191919.19' }).expect(200);
    await a.as.OWNER_MANAGER.patch(`/api/bookings/${stay.id}/amounts`, { addonRevenue: `${PII.name}` }).expect(400);
    await a.as.OWNER_MANAGER.get(`${base}/${PII.name}/missing`).expect(400);
    await a.as.STAFF.get('/api/tax/reports').expect(403);

    // The renderer and the store fail with messages that quote the owner and the address: a 500, only the type is logged.
    render.mockRejectedValueOnce(new Error(`render failed for ${PII.name} ${PII.city} TAXID-QX-99`));
    expect((await a.as.OWNER_MANAGER.post(`${base}/2026-03`)).status).toBe(500);
    jest.spyOn(t.app.get(StorageService), 'put').mockRejectedValueOnce(new Error(`write failed for ${PII.name} at ${PII.city}`));
    expect((await a.as.OWNER_MANAGER.post(`${base}/2026-03`)).status).toBe(500);

    expect(JSON.stringify(await t.prisma.auditLog.findMany())).not.toContain('9191919');
    expect(output).not.toContain('9191919');
    expect(output).not.toContain('4242424');
    await expectClean(['TAXID-QX-99']);
  });

  it('the checklist routes, including storage failures that quote the note and the document, leave no note, file content or personal data in the logs or the audit trail', async () => {
    await t.prisma.checklistTemplateStep.create({ data: { code: 'log_step', position: 1, nameFr: 'Étape de test', nameEn: 'Test step' } });
    const property = await t.prisma.property.findFirstOrThrow({ where: { accountId: a.accountId } });
    const base = `/api/properties/${property.id}/checklist`;
    const marker = `LICENCE-BODY-${PII.docNumber}`;
    const pdf = `%PDF-1.4\n${marker} ${PII.name}\n%%EOF`;

    const item = ((await a.as.OWNER_MANAGER.get(base).expect(200)).body as { items: { id: string }[] }).items[0]!;
    await a.as.OWNER_MANAGER.patch(`${base}/${item.id}`, { status: 'IN_PROGRESS', note: `${PII.name} ${PII.city}`, dueDate: '2026-12-01' }).expect(200);
    await a.as.OWNER_MANAGER.patch(`${base}/${item.id}`, { note: 'x'.repeat(501) + PII.name }).expect(400);
    await a.as.OWNER_MANAGER.patch(`${base}/${item.id}`, { dueDate: PII.name }).expect(400);
    await a.as.OWNER_MANAGER.upload(`${base}/${item.id}/document`, pdf, {}, `${PII.name}.pdf`).expect(200);
    await a.as.OWNER_MANAGER.upload(`${base}/${item.id}/document`, `${PII.name} is not a document`, {}, `${PII.name}.pdf`).expect(422);
    await a.as.OWNER_MANAGER.get(`${base}/${item.id}/document`).expect(200);
    await a.as.STAFF.get(base).expect(200);
    await a.as.STAFF.get(`${base}/${item.id}/document`).expect(403);

    // Storage fails with messages that quote the note, the file name and the owner: a 500, only the type is logged.
    jest.spyOn(t.app.get(StorageService), 'put').mockRejectedValueOnce(new Error(`write failed for ${PII.name} ${marker}`));
    expect((await a.as.OWNER_MANAGER.upload(`${base}/${item.id}/document`, pdf, {}, 'again.pdf')).status).toBe(500);
    jest.spyOn(t.app.get(StorageService), 'read').mockRejectedValueOnce(new Error(`read failed for ${PII.name} ${marker}`));
    expect((await a.as.OWNER_MANAGER.get(`${base}/${item.id}/document`)).status).toBe(500);
    await a.as.OWNER_MANAGER.delete(`${base}/${item.id}/document`).expect(204);

    expect(output).not.toContain(marker);
    expect(JSON.stringify(await t.prisma.auditLog.findMany())).not.toContain(marker);
    await expectClean([marker]);
  });

  it('WhatsApp delivery, including provider and network failures that quote the number, the link and the message, leaves no number, token or body in the logs, the deliveries or the audit trail', async () => {
    const phone = '+212611223344';
    const secret = 'app-secret-for-logging-0123456789';
    await t.prisma.ruleConfig.upsert({ where: { key: 'whatsapp.templates' }, update: {}, create: { key: 'whatsapp.templates', value: { checkin_link: { name: 'checkin_link_v1', language: 'fr' }, day_counter_alert: { name: 'alert_v1', language: 'fr' } }, validatedBy: 'Founder' } });
    await t.prisma.ruleConfig.upsert({ where: { key: 'messaging.quiet_hours' }, update: {}, create: { key: 'messaging.quiet_hours', value: { start: '00:00', end: '00:00', timezone: 'Africa/Casablanca' }, validatedBy: 'Founder' } });
    const provider = t.app.get<StubWhatsAppProvider>(WHATSAPP_PROVIDER);
    const link = `/api/bookings/${bookingId}/checkin-links`;

    const ok = (await a.as.OWNER_MANAGER.post(link, { whatsappTo: phone }).expect(201)).body as { token: string; url: string; id: string };
    await a.as.OWNER_MANAGER.post(link, { whatsappTo: `${PII.name} ${phone}` }).expect(400);
    await a.as.OWNER_MANAGER.post(`/api/checkin-links/${ok.id}/resend`, { whatsappTo: '0611223344' }).expect(400);
    await a.as.OWNER_MANAGER.get(`/api/checkin-links/${ok.id}/deliveries`).expect(200);
    await a.as.OWNER_MANAGER.put('/api/me/phone', { phone }).expect(200);
    await a.as.OWNER_MANAGER.put('/api/me/phone', { phone: `${PII.name} ${phone}` }).expect(400);
    await a.as.OWNER_MANAGER.put('/api/me/notification-preferences', { alertType: 'day_counter.red', channel: 'WHATSAPP' }).expect(200);
    await a.as.OWNER_MANAGER.get('/api/me/notification-preferences').expect(200);

    // The provider fails with messages that quote the number, the link and the message text: only a fixed code is kept.
    const quoting = `send to ${phone} failed: ${ok.url} body "${PII.name}" token ${ok.token}`;
    jest.spyOn(provider, 'send').mockRejectedValueOnce(new Error(quoting));
    expect((await a.as.OWNER_MANAGER.post(link, { whatsappTo: phone }).expect(201)).body.delivery.status).toBe('FAILED');
    jest.spyOn(t.app.get(MessagingService), 'send').mockRejectedValueOnce(new Error(quoting));
    expect((await a.as.OWNER_MANAGER.post(link, { whatsappTo: phone })).status).toBe(500);

    // The webhook: unsigned, wrongly signed, and signed reports, with an inbound message full of personal data.
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered', recipient_id: phone }], messages: [{ from: phone, text: { body: PII.name } }] } }] }] });
    const hook = (sig?: string) => request(t.app.getHttpServer()).post('/api/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', sig ?? '').send(body);
    expect((await hook()).status).toBe(404);
    expect((await hook(`sha256=${'1'.repeat(64)}`)).status).toBe(404);
    expect((await hook(sign(Buffer.from(body), secret))).status).toBe(200);
    expect((await request(t.app.getHttpServer()).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-verify-token-0123456789', 'hub.challenge': '1' })).status).toBe(404);

    const everything = JSON.stringify([await t.prisma.messageDelivery.findMany(), await t.prisma.auditLog.findMany(), await t.prisma.checkInLink.findMany()]);
    for (const value of [phone.slice(1), ok.token, 'token=', PII.name, 'wamid.X', secret]) {
      expect({ value, inLogs: output.includes(value) }).toEqual({ value, inLogs: false });
      expect({ value, inStored: everything.includes(value) }).toEqual({ value, inStored: false });
    }
    await expectClean([phone]);
  });
});
