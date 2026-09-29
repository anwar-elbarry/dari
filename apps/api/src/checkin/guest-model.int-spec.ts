import { createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';

requireDatabase();

/**
 * The guest tables hold the most sensitive data in the product. Whatever a service forgets to check, the
 * database itself must refuse a row that mixes accounts, or a guest whose property is not its booking's.
 */
describe('guest check-in model: tenant integrity (integration)', () => {
  let t: TestApp;

  interface Side {
    account: string;
    property: string;
    booking: string;
    link: string;
    object: string;
  }
  let A: Side;
  let B: Side;
  let A2property: string; // a second property of account A

  async function seedSide(name: string): Promise<Side> {
    const account = (await t.prisma.account.create({ data: { companyName: name } })).id;
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: account, name: `Owner ${name}`, residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({
      data: { accountId: account, ownerId: owner.id, name: `Prop ${name}`, address: 'x', commune: 'Marrakech', licenseType: 'RIAD' },
    });
    const booking = await t.prisma.booking.create({
      data: { accountId: account, propertyId: property.id, checkIn: new Date('2026-10-01'), checkOut: new Date('2026-10-04'), source: 'DIRECT' },
    });
    const link = await t.prisma.checkInLink.create({
      data: { accountId: account, bookingId: booking.id, tokenHash: `hash-${name}`, expiresAt: new Date('2026-10-06'), createdBy: 'u', maxGuests: 2 },
    });
    const object = await t.prisma.storedObject.create({
      data: { accountId: account, key: `${account}/id_image/${name}`, kind: 'ID_IMAGE', sizeBytes: 10, sha256: 'a'.repeat(64), wrappedKey: 'k1:x' },
    });
    return { account, property: property.id, booking: booking.id, link: link.id, object: object.id };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    A = await seedSide('A');
    B = await seedSide('B');
    const owner = await t.prisma.propertyOwner.findFirstOrThrow({ where: { accountId: A.account } });
    A2property = (
      await t.prisma.property.create({ data: { accountId: A.account, ownerId: owner.id, name: 'Prop A2', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } })
    ).id;
  });

  const guest = (over: Partial<{ accountId: string; bookingId: string; propertyId: string; linkId: string; guestIndex: number; docImageId: string | null }> = {}) =>
    t.prisma.guestCheckIn.create({
      data: { accountId: A.account, bookingId: A.booking, propertyId: A.property, linkId: A.link, guestIndex: 1, ...over },
    });

  describe('check-in links', () => {
    it('accepts a link on a booking of its own account, and refuses another account booking', async () => {
      await expect(
        t.prisma.checkInLink.create({ data: { accountId: A.account, bookingId: A.booking, tokenHash: 'h2', expiresAt: new Date(), createdBy: 'u', maxGuests: 1 } }),
      ).resolves.toBeDefined();
      await expect(
        t.prisma.checkInLink.create({ data: { accountId: A.account, bookingId: B.booking, tokenHash: 'h3', expiresAt: new Date(), createdBy: 'u', maxGuests: 1 } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('stores a token hash only once', async () => {
      await expect(
        t.prisma.checkInLink.create({ data: { accountId: A.account, bookingId: A.booking, tokenHash: 'hash-A', expiresAt: new Date(), createdBy: 'u', maxGuests: 1 } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('guests', () => {
    it('accepts a consistent guest, with or without an image', async () => {
      await expect(guest()).resolves.toMatchObject({ status: 'PENDING', guestIndex: 1, docImageId: null });
      await expect(guest({ guestIndex: 2, docImageId: A.object })).resolves.toBeDefined();
    });

    it('refuses a booking, link or image of another account', async () => {
      await expect(guest({ bookingId: B.booking, propertyId: B.property })).rejects.toMatchObject({ code: 'P2003' });
      await expect(guest({ linkId: B.link })).rejects.toMatchObject({ code: 'P2003' });
      await expect(guest({ docImageId: B.object })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('refuses a property that is not the booking property, even inside one account', async () => {
      await expect(guest({ propertyId: A2property })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('numbers guests once per booking', async () => {
      await guest({ guestIndex: 1 }).catch(() => undefined);
      await expect(guest({ guestIndex: 1 })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('keeps the image object while a guest references it', async () => {
      const g = await guest({ docImageId: A.object });
      await expect(t.prisma.storedObject.delete({ where: { id: A.object } })).rejects.toMatchObject({ code: 'P2003' });
      await t.prisma.guestCheckIn.update({ where: { id: g.id }, data: { docImageId: null } });
      await expect(t.prisma.storedObject.delete({ where: { id: A.object } })).resolves.toBeDefined();
    });
  });

  describe('fiche de police', () => {
    const fiche = (over: Partial<{ accountId: string; guestCheckInId: string; pdfObjectId: string }> & { guestCheckInId: string }) =>
      t.prisma.ficheDePolice.create({ data: { accountId: A.account, pdfObjectId: A.object, templateVersion: 'v1', sha256: 'b'.repeat(64), ...over } });

    it('accepts a fiche for a guest and PDF of the same account, once per guest', async () => {
      const g = await guest();
      await expect(fiche({ guestCheckInId: g.id })).resolves.toBeDefined();
      await expect(fiche({ guestCheckInId: g.id })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('refuses a guest or PDF of another account', async () => {
      const g = await guest();
      const gB = await t.prisma.guestCheckIn.create({ data: { accountId: B.account, bookingId: B.booking, propertyId: B.property, linkId: B.link, guestIndex: 1 } });
      await expect(fiche({ guestCheckInId: gB.id })).rejects.toMatchObject({ code: 'P2003' });
      await expect(fiche({ guestCheckInId: g.id, pdfObjectId: B.object })).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  it('records the exact consent wording a guest agreed to', async () => {
    const text = await t.prisma.consentText.create({ data: { version: 'v1', locale: 'fr', body: 'texte', approvedBy: 'counsel', approvedAt: new Date() } });
    const g = await guest({ guestIndex: 1 });
    const updated = await t.prisma.guestCheckIn.update({ where: { id: g.id }, data: { consentTextId: text.id, consentAt: new Date() }, include: { consentText: true } });
    expect(updated.consentText).toMatchObject({ version: 'v1', locale: 'fr' });
  });
});
