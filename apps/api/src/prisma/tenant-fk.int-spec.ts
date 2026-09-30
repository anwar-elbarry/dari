import { createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';

requireDatabase();

/**
 * Database-level guard behind the account scope: even a service that forgets to check a foreign key
 * through the scoped client cannot point a row at another account's row.
 */
describe('composite tenant foreign keys (integration)', () => {
  let t: TestApp;
  let a: string;
  let b: string;
  let ownerA: string;
  let ownerB: string;
  let propertyB: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    a = (await t.prisma.account.create({ data: { companyName: 'A' } })).id;
    b = (await t.prisma.account.create({ data: { companyName: 'B' } })).id;
    ownerA = (await t.prisma.propertyOwner.create({ data: { accountId: a, name: 'Owner A', residency: 'RESIDENT' } })).id;
    ownerB = (await t.prisma.propertyOwner.create({ data: { accountId: b, name: 'Owner B', residency: 'RESIDENT' } })).id;
    propertyB = (
      await t.prisma.property.create({ data: { accountId: b, ownerId: ownerB, name: 'Prop B', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } })
    ).id;
  });

  const property = (accountId: string, ownerId: string) =>
    t.prisma.property.create({ data: { accountId, ownerId, name: 'P', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } });

  it('refuses a property whose owner belongs to another account', async () => {
    await expect(property(a, ownerB)).rejects.toMatchObject({ code: 'P2003' });
    await expect(property(a, ownerA)).resolves.toBeDefined();
  });

  it('refuses moving a property to an owner of another account', async () => {
    const p = await property(a, ownerA);
    await expect(t.prisma.property.update({ where: { id: p.id }, data: { ownerId: ownerB } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('refuses a booking, calendar feed or import batch on a property of another account', async () => {
    await expect(
      t.prisma.booking.create({ data: { accountId: a, propertyId: propertyB, checkIn: new Date('2026-10-01'), checkOut: new Date('2026-10-03'), source: 'DIRECT' } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      t.prisma.icalFeed.create({ data: { accountId: a, propertyId: propertyB, platform: 'AIRBNB', url: 'https://example.test/x.ics' } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      t.prisma.importBatch.create({ data: { accountId: a, propertyId: propertyB, fileName: 'x.csv', rowCount: 1, importedCount: 1, errorCount: 0, createdBy: 'u' } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('still cascades a property delete to its calendar feeds', async () => {
    await t.prisma.icalFeed.create({ data: { accountId: b, propertyId: propertyB, platform: 'AIRBNB', url: 'https://example.test/x.ics' } });
    await t.prisma.property.delete({ where: { id: propertyB } });
    expect(await t.prisma.icalFeed.count()).toBe(0);
  });

  describe('police registers and share links (Phase 4)', () => {
    const stored = (accountId: string) => t.prisma.storedObject.create({ data: { accountId, key: `k-${Math.random()}`, kind: 'POLICE_REGISTER_PDF', sizeBytes: 1, sha256: 'a'.repeat(64), wrappedKey: 'w' } });
    const register = (accountId: string, propertyId: string, pdfObjectId: string, month = '2026-10') =>
      t.prisma.policeRegister.create({ data: { accountId, propertyId, month, pdfObjectId, templateVersion: 'draft-1', sha256: 'a'.repeat(64), inputDigest: 'd', guestCount: 0, validation: {}, generatedBy: 'u' } });

    it('refuses a register on a property or a PDF of another account, accepts its own', async () => {
      const propertyA = (await property(a, ownerA)).id;
      const pdfA = (await stored(a)).id;
      const pdfB = (await stored(b)).id;
      await expect(register(a, propertyB, pdfA)).rejects.toMatchObject({ code: 'P2003' });
      await expect(register(a, propertyA, pdfB)).rejects.toMatchObject({ code: 'P2003' });
      await expect(register(a, propertyA, pdfA)).resolves.toBeDefined();
    });

    it('allows one register per property and month', async () => {
      const propertyA = (await property(a, ownerA)).id;
      await register(a, propertyA, (await stored(a)).id);
      await expect(register(a, propertyA, (await stored(a)).id)).rejects.toMatchObject({ code: 'P2002' });
      await expect(register(a, propertyA, (await stored(a)).id, '2026-11')).resolves.toBeDefined();
    });

    it('refuses an access row that points at a share link of another account', async () => {
      const link = (accountId: string) =>
        t.prisma.shareLink.create({ data: { accountId, resourceType: 'POLICE_REGISTER', resourceId: 'r', tokenHash: `h-${Math.random()}`, recipientLabel: 'Prefecture', expiresAt: new Date(Date.now() + 86_400_000), createdBy: 'u' } });
      const linkB = await link(b);
      await expect(t.prisma.shareAccess.create({ data: { accountId: a, shareLinkId: linkB.id, userAgent: 'x' } })).rejects.toMatchObject({ code: 'P2003' });
      await expect(t.prisma.shareAccess.create({ data: { accountId: b, shareLinkId: linkB.id, userAgent: 'x' } })).resolves.toBeDefined();
    });
  });

  describe('tax reports (Phase 5)', () => {
    const stored = (accountId: string, kind: 'TAX_REPORT_PDF' | 'TAX_REPORT_XLSX') => t.prisma.storedObject.create({ data: { accountId, key: `k-${Math.random()}`, kind, sizeBytes: 1, sha256: 'a'.repeat(64), wrappedKey: 'w' } });
    const report = (accountId: string, propertyId: string, pdfObjectId: string, xlsxObjectId: string, month = '2026-10') =>
      t.prisma.taxReport.create({
        data: {
          accountId, propertyId, month, regime: 'PROPERTY_INCOME', nightsRevenue: '0', addonRevenue: '0', grossBase: '0', taxeSejourDeducted: '0', vatTotal: '0', incomeTaxTotal: '0', localTaxTotal: '0',
          lines: [], problems: [], ruleVersions: [], unvalidated: true, inputDigest: 'd', pdfObjectId, xlsxObjectId, templateVersion: 'draft-1', disclaimerVersion: 'beta-1', generatedBy: 'u',
        },
      });

    it('refuses a report on a property, a PDF or an Excel file of another account, accepts its own', async () => {
      const propertyA = (await property(a, ownerA)).id;
      const [pdfA, xlsxA, pdfB, xlsxB] = [(await stored(a, 'TAX_REPORT_PDF')).id, (await stored(a, 'TAX_REPORT_XLSX')).id, (await stored(b, 'TAX_REPORT_PDF')).id, (await stored(b, 'TAX_REPORT_XLSX')).id];
      await expect(report(a, propertyB, pdfA, xlsxA)).rejects.toMatchObject({ code: 'P2003' });
      await expect(report(a, propertyA, pdfB, xlsxA)).rejects.toMatchObject({ code: 'P2003' });
      await expect(report(a, propertyA, pdfA, xlsxB)).rejects.toMatchObject({ code: 'P2003' });
      await expect(report(a, propertyA, pdfA, xlsxA)).resolves.toBeDefined();
    });

    it('allows one report per property and month', async () => {
      const propertyA = (await property(a, ownerA)).id;
      await report(a, propertyA, (await stored(a, 'TAX_REPORT_PDF')).id, (await stored(a, 'TAX_REPORT_XLSX')).id);
      await expect(report(a, propertyA, (await stored(a, 'TAX_REPORT_PDF')).id, (await stored(a, 'TAX_REPORT_XLSX')).id)).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
