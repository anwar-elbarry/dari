import http from 'node:http';
import { AddressInfo } from 'node:net';
import { addDays, toCalendarDate } from './parse';
import { SyncProcessor } from './sync.processor';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TEST_REDIS_URL, TestApp } from '../test/test-app';

requireDatabase();

const today = toCalendarDate(new Date(), false);
const D = (offset: number) => addDays(today, offset).replace(/-/g, '');

function event(uid: string, start: number, end: number, summary: string, extra = '') {
  return `BEGIN:VEVENT\nUID:${uid}\nDTSTART;VALUE=DATE:${D(start)}\nDTEND;VALUE=DATE:${D(end)}\nSUMMARY:${summary}\n${extra}END:VEVENT\n`;
}
const calendar = (events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${events.join('')}END:VCALENDAR\n`;

const PAST = event('past@airbnb.com', -20, -15, 'Reserved');
const FUTURE = event('future@airbnb.com', 5, 9, 'Reserved');
const BLOCK = event('block@airbnb.com', 12, 14, 'Airbnb (Not available)');
const ODD = event('odd@airbnb.com', 20, 22, 'Something else');

describe('calendar sync (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let propertyId: string;
  let server: http.Server;
  let base: string;
  let body = calendar([PAST, FUTURE, BLOCK, ODD]);
  let status = 200;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'text/calendar' });
      res.end(status === 200 ? body : 'error');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    t = await createTestApp({ env: { ICAL_ALLOW_INSECURE: 'true' } });
  });

  afterAll(async () => {
    await t.app.close();
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    a = await seedAccount(t, 'Alpha');
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'O', residency: 'RESIDENT' } });
    propertyId = (await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } })).id;
    body = calendar([PAST, FUTURE, BLOCK, ODD]);
    status = 200;
  });

  const feeds = () => `/api/properties/${propertyId}/feeds`;
  const addFeed = async (platform = 'AIRBNB') => (await a.as.OWNER_MANAGER.post(feeds(), { platform, url: `${base}/cal.ics` }).expect(201)).body;
  const bookings = () => t.prisma.booking.findMany({ orderBy: { checkIn: 'asc' } });

  it('creates a feed and refuses duplicates and bad links', async () => {
    const feed = await addFeed();
    expect(feed).toMatchObject({ platform: 'AIRBNB', url: `${base}/cal.ics`, lastStatus: 'NEVER', eventCount: 0 });
    expect((await a.as.OWNER_MANAGER.post(feeds(), { platform: 'AIRBNB', url: `${base}/other.ics` }).expect(409)).body.error.code).toBe('FEED_EXISTS');
    const bad = await a.as.OWNER_MANAGER.post(feeds(), { platform: 'BOOKING', url: 'https://user:pw@example.test/x.ics' }).expect(400);
    expect(bad.body.error.details[0].field).toBe('url');
    await a.as.OWNER_MANAGER.post(feeds(), { platform: 'BOOKING', url: 'ftp://example.test/x.ics' }).expect(400);
  });

  it('first sync creates classified bookings; second sync changes nothing', async () => {
    const feed = await addFeed();
    const first = await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    expect(first.body).toEqual({ ok: true, created: 4, updated: 0, cancelled: 0, skipped: 0 });

    const rows = await bookings();
    expect(rows.map((b) => [b.externalUid, b.classification, b.status, b.summary])).toEqual([
      ['past@airbnb.com', 'BOOKING', 'CONFIRMED', 'Reserved'],
      ['future@airbnb.com', 'BOOKING', 'CONFIRMED', 'Reserved'],
      ['block@airbnb.com', 'OWNER_BLOCK', 'CONFIRMED', 'Airbnb (Not available)'],
      ['odd@airbnb.com', 'UNCERTAIN', 'CONFIRMED', 'Something else'],
    ]);
    expect(rows.every((b) => b.accountId === a.accountId && b.propertyId === propertyId && b.source === 'AIRBNB')).toBe(true);

    const second = await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    expect(second.body).toEqual({ ok: true, created: 0, updated: 0, cancelled: 0, skipped: 0 });
    const list = await a.as.OWNER_MANAGER.get(feeds()).expect(200);
    expect(list.body[0]).toMatchObject({ lastStatus: 'OK', lastError: null, eventCount: 4 });
  });

  it('cancels a future stay that left the feed, keeps a past one, and updates changed dates', async () => {
    const feed = await addFeed();
    await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);

    body = calendar([event('block@airbnb.com', 12, 16, 'Airbnb (Not available)'), ODD]); // PAST and FUTURE gone, BLOCK extended
    const res = await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    expect(res.body).toMatchObject({ ok: true, created: 0, updated: 1, cancelled: 1 });

    const byUid = Object.fromEntries((await bookings()).map((b) => [b.externalUid, b]));
    expect(byUid['past@airbnb.com'].status).toBe('CONFIRMED');
    expect(byUid['future@airbnb.com'].status).toBe('CANCELLED');
    expect(byUid['future@airbnb.com'].cancelledAt).not.toBeNull();
    expect(byUid['block@airbnb.com'].checkOut.toISOString().slice(0, 10)).toBe(addDays(today, 16));
  });

  it('honours an explicit CANCELLED status and never overwrites a manual classification', async () => {
    const feed = await addFeed();
    await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    const odd = (await bookings()).find((b) => b.externalUid === 'odd@airbnb.com')!;
    await t.prisma.booking.update({ where: { id: odd.id }, data: { classification: 'OWNER_BLOCK', classifiedBy: 'MANUAL' } });

    body = calendar([PAST, event('future@airbnb.com', 5, 9, 'Reserved', 'STATUS:CANCELLED\n'), BLOCK, event('odd@airbnb.com', 20, 22, 'Reserved')]);
    await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);

    const byUid = Object.fromEntries((await bookings()).map((b) => [b.externalUid, b]));
    expect(byUid['future@airbnb.com'].status).toBe('CANCELLED');
    expect(byUid['odd@airbnb.com']).toMatchObject({ classification: 'OWNER_BLOCK', classifiedBy: 'MANUAL', summary: 'Reserved' });
  });

  it('keeps existing bookings and records a sanitised error when the feed fails', async () => {
    const feed = await addFeed();
    await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    status = 503;
    const res = await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    expect(res.body).toMatchObject({ ok: false, error: expect.stringContaining('503') });
    const [row] = (await a.as.OWNER_MANAGER.get(feeds()).expect(200)).body;
    expect(row).toMatchObject({ lastStatus: 'ERROR', eventCount: 4 });
    expect(row.lastError).not.toContain('127.0.0.1');
    expect(await t.prisma.booking.count({ where: { status: 'CONFIRMED' } })).toBe(4);

    status = 200;
    body = 'this is not a calendar';
    const notCal = await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    expect(notCal.body.ok).toBe(false);
  });

  it('deleting a feed keeps its bookings; the feed URL never reaches the audit log', async () => {
    const feed = await addFeed();
    await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    await a.as.OWNER_MANAGER.delete(`${feeds()}/${feed.id}`).expect(204);
    expect(await t.prisma.booking.count()).toBe(4);
    expect(await t.prisma.booking.count({ where: { feedId: null } })).toBe(4);
    expect(JSON.stringify(await t.prisma.auditLog.findMany())).not.toContain(base);
    expect((await t.prisma.auditLog.findMany({ where: { resourceType: 'IcalFeed' } })).map((x) => x.action).sort()).toEqual(['ical_feed.created', 'ical_feed.deleted']);
  });

  it('refuses a calendar with too many events and records the error', async () => {
    const many = Array.from({ length: 2001 }, (_, i) => event(`e${i}@x`, i % 200 + 1, i % 200 + 2, 'Reserved'));
    body = calendar(many);
    const feed = await addFeed();
    const res = await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    expect(res.body).toMatchObject({ ok: false, error: 'The calendar has too many events.' });
    expect(await t.prisma.booking.count()).toBe(0);
    expect((await a.as.OWNER_MANAGER.get(feeds())).body[0]).toMatchObject({ lastStatus: 'ERROR' });
  });

  it('skips events with an oversized UID instead of failing', async () => {
    body = calendar([event('x'.repeat(300), 5, 7, 'Reserved'), FUTURE]);
    const feed = await addFeed();
    const res = await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
    expect(res.body).toMatchObject({ ok: true, created: 1, skipped: 1 });
  });

  it('survives two syncs of the same feed at once', async () => {
    const feed = await addFeed();
    const [r1, r2] = await Promise.all([
      a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`),
      a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(await t.prisma.booking.count()).toBe(4);
    expect(r1.body.ok && r2.body.ok).toBe(true);
    expect(r1.body.created + r2.body.created).toBe(4);
  });

  it('records a database failure on the feed instead of leaving it looking healthy', async () => {
    const feed = await addFeed();
    const sync = t.app.get((await import('./sync.service')).SyncService) as unknown as { reconcile: () => Promise<unknown> };
    const original = sync.reconcile;
    sync.reconcile = async () => {
      throw new Error('boom');
    };
    try {
      const res = await a.as.OWNER_MANAGER.post(`${feeds()}/${feed.id}/sync`).expect(200);
      expect(res.body.ok).toBe(false);
    } finally {
      sync.reconcile = original;
    }
    expect((await a.as.OWNER_MANAGER.get(feeds())).body[0]).toMatchObject({ lastStatus: 'ERROR' });
  });
});

// The scheduled path only exists with Redis: it must really enqueue and run jobs (a rejected job id once made it a no-op).
const describeRedis = TEST_REDIS_URL ? describe : describe.skip;
describeRedis('scheduled sync through the queue (integration)', () => {
  let t: TestApp;
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar' });
      res.end(calendar([FUTURE, BLOCK]));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    t = await createTestApp({ env: { ICAL_ALLOW_INSECURE: 'true' } });
  });
  afterAll(async () => {
    await t.app.close();
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('sync-all enqueues one job per feed and the worker syncs them', async () => {
    await resetDatabase(t.prisma, t.redis);
    const a = await seedAccount(t, 'Alpha');
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'O', residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } });
    const feed = await t.prisma.icalFeed.create({ data: { accountId: a.accountId, propertyId: property.id, platform: 'AIRBNB', url: `${base}/cal.ics` } });

    const processor = t.app.get(SyncProcessor);
    const result = await processor.process({ name: 'sync-all', data: {} } as never);
    expect(result).toEqual({ enqueued: 1 });

    const deadline = Date.now() + 8000;
    let row = await t.prisma.icalFeed.findUniqueOrThrow({ where: { id: feed.id } });
    while (row.lastStatus === 'NEVER' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      row = await t.prisma.icalFeed.findUniqueOrThrow({ where: { id: feed.id } });
    }
    expect(row.lastStatus).toBe('OK');
    expect(await t.prisma.booking.count({ where: { feedId: feed.id } })).toBe(2);

    // Firing again inside the same interval is a harmless no-op, not an error.
    await expect(processor.process({ name: 'sync-all', data: {} } as never)).resolves.toEqual({ enqueued: 1 });
  });
});
