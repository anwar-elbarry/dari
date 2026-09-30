import request from 'supertest';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { MessagingService } from './messaging.service';
import { sign } from './signature';

requireDatabase();

const SECRET = 'app-secret-for-tests-0123456789';
const VERIFY = 'verify-token-for-tests-0123456789';
const URL = '/api/webhooks/whatsapp';

describe('WhatsApp webhook (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let ids: string[];

  beforeAll(async () => {
    t = await createTestApp({ env: { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY } });
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    a = await seedAccount(t, 'Alpha');
    ids = [];
    for (const n of [1, 2]) {
      const row = await t.prisma.messageDelivery.create({ data: { accountId: a.accountId, channel: 'WHATSAPP', template: 't', subjectType: 'CHECKIN_LINK', subjectId: `l${n}`, status: 'SENT', providerMessageId: `wamid.T${n}` } });
      ids.push(row.id);
    }
  });

  const payload = (...statuses: { id: string; status: string }[]) => Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { statuses, messages: [{ from: '212600000000', text: { body: 'private inbound text' } }] } }] }] }));
  const post = (body: Buffer | string, signature?: string, type = 'application/json') => {
    const req = request(t.app.getHttpServer()).post(URL).set('content-type', type);
    if (signature !== undefined) req.set('x-hub-signature-256', signature);
    // A Buffer would be JSON-serialised by superagent; the exact bytes are what is signed.
    return req.send(typeof body === 'string' ? body : body.toString('utf8'));
  };
  const status = async (n: number) => (await t.prisma.messageDelivery.findUniqueOrThrow({ where: { id: ids[n - 1]! } })).status;

  describe('registration handshake (GET)', () => {
    const verify = (q: Record<string, string>) => request(t.app.getHttpServer()).get(URL).query(q);

    it('echoes the challenge for the right token only', async () => {
      const ok = await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1158201444' }).expect(200);
      expect(ok.text).toBe('1158201444');
      expect(ok.headers['cache-control']).toBe('no-store');
    });

    it.each([
      ['a wrong token', { 'hub.mode': 'subscribe', 'hub.verify_token': 'x'.repeat(VERIFY.length), 'hub.challenge': '1' }],
      ['a wrong mode', { 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1' }],
      ['no token', { 'hub.mode': 'subscribe', 'hub.challenge': '1' }],
      ['no challenge', { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY }],
      ['a challenge that is not a plain word', { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '<script>alert(1)</script>' }],
      ['nothing', {}],
    ])('answers the same neutral 404 for %s', async (_n, q) => {
      const res = await verify(q).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.text).not.toContain(VERIFY);
    });
  });

  describe('delivery reports (POST)', () => {
    it('applies signed reports, without the CSRF header, and answers with nothing about the data', async () => {
      const body = payload({ id: 'wamid.T1', status: 'delivered' }, { id: 'wamid.T2', status: 'read' });
      const res = await post(body, sign(body, SECRET)).expect(200);
      expect(res.body).toEqual({ ok: true });
      expect([await status(1), await status(2)]).toEqual(['DELIVERED', 'READ']);
    });

    it('is idempotent and forward-only when Meta redelivers or reorders', async () => {
      const read = payload({ id: 'wamid.T1', status: 'read' });
      const sent = payload({ id: 'wamid.T1', status: 'sent' });
      await post(read, sign(read, SECRET)).expect(200);
      await post(read, sign(read, SECRET)).expect(200);
      await post(sent, sign(sent, SECRET)).expect(200);
      expect(await status(1)).toBe('READ');
    });

    it('ignores unknown ids and stores nothing of the inbound message', async () => {
      const body = payload({ id: 'wamid.NOPE', status: 'delivered' });
      await post(body, sign(body, SECRET)).expect(200);
      expect(JSON.stringify(await t.prisma.messageDelivery.findMany())).not.toMatch(/private inbound|212600000000/);
      expect(JSON.stringify(await t.prisma.auditLog.findMany())).not.toMatch(/private inbound|212600000000/);
    });

    it.each([
      ['no signature', undefined],
      ['an empty signature', ''],
      ['a wrong signature', `sha256=${'0'.repeat(64)}`],
      ['a signature with the wrong secret', 'WRONG'],
      ['a signature in the wrong scheme', 'sha1=abcdef'],
    ])('answers the same neutral 404 for %s, and changes nothing', async (_n, signature) => {
      const body = payload({ id: 'wamid.T1', status: 'read' });
      const sig = signature === 'WRONG' ? sign(body, 'another-secret-0123456789') : signature;
      const res = await post(body, sig).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await status(1)).toBe('SENT');
    });

    it('a valid signature over a different body is refused (the raw bytes are what is signed)', async () => {
      const signed = payload({ id: 'wamid.T1', status: 'sent' });
      const tampered = payload({ id: 'wamid.T1', status: 'read' });
      await post(tampered, sign(signed, SECRET)).expect(404);
      expect(await status(1)).toBe('SENT');
    });

    it('refuses an empty body, a body that is not JSON (even if signed), and a body over the limit', async () => {
      await post('', sign(Buffer.from(''), SECRET)).expect(404);
      const junk = Buffer.from('not json at all');
      await post(junk, sign(junk, SECRET)).expect(404);
      const huge = Buffer.alloc(300 * 1024, 'a');
      expect((await post(huge, sign(huge, SECRET))).status).toBe(413);
    });

    it('reads the raw bytes whatever the content type says', async () => {
      const body = payload({ id: 'wamid.T1', status: 'delivered' });
      await post(body, sign(body, SECRET), 'text/plain').expect(200);
      expect(await status(1)).toBe('DELIVERED');
    });

    it('other methods on the route are neutral 404s', async () => {
      for (const method of ['put', 'delete', 'patch'] as const) {
        expect((await request(t.app.getHttpServer())[method](URL).set('x-requested-with', 'dari')).status).toBe(404);
      }
    });

    it('never sets a cookie or an open CORS header', async () => {
      const body = payload({ id: 'wamid.T1', status: 'delivered' });
      const res = await post(body, sign(body, SECRET)).expect(200);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('the signed body cannot be used to act as a user: the CSRF exemption covers this route only', async () => {
      const body = Buffer.from('{}');
      // Another public POST still needs the CSRF header even with a "valid" signature header.
      const res = await request(t.app.getHttpServer()).post('/api/auth/login').set('x-hub-signature-256', sign(body, SECRET)).send({ email: 'a@b.test', password: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_HEADER_MISSING');
    });
  });
});

describe('WhatsApp webhook when it is not configured or switched off (integration)', () => {
  it('answers 404 without a secret configured, even for a well-formed request', async () => {
    const t = await createTestApp();
    try {
      const body = Buffer.from('{}');
      expect((await request(t.app.getHttpServer()).post(URL).set('content-type', 'application/json').set('x-hub-signature-256', sign(body, SECRET)).send(body)).status).toBe(404);
      expect((await request(t.app.getHttpServer()).get(URL).query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1' })).status).toBe(404);
    } finally {
      await t.app.close();
    }
  });

  it('answers 404 when WHATSAPP_ENABLED is off, whatever the signature', async () => {
    const t = await createTestApp({ env: { WHATSAPP_ENABLED: 'false', WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY } });
    try {
      const body = Buffer.from('{}');
      expect((await request(t.app.getHttpServer()).post(URL).set('content-type', 'application/json').set('x-hub-signature-256', sign(body, SECRET)).send(body)).status).toBe(404);
      expect((await request(t.app.getHttpServer()).get(URL).query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1' })).status).toBe(404);
      expect(t.app.get(MessagingService)).toBeDefined();
    } finally {
      await t.app.close();
    }
  });
});
