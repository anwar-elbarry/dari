import { ResendMailDriver } from './http-drivers';

const message = { from: 'Dari <no-reply@dari.test>', to: 'owner@example.test', subject: 'Reset', text: 'Link https://app.test/reset#token=abc' };

describe('HTTP mail drivers', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('Resend: posts to the emails endpoint with a bearer key', async () => {
    await new ResendMailDriver('re_key_123').send(message);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer re_key_123');
    expect(JSON.parse(init.body)).toEqual({ from: message.from, to: [message.to], subject: 'Reset', text: message.text });
  });

  it.each([['Resend', () => new ResendMailDriver('k'.repeat(10))]])('%s: a provider error or network failure throws without the recipient, body or response text', async (_n, make) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'invalid recipient owner@example.test' });
    const failure = await make().send(message).catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Mail provider responded with HTTP 422');

    fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND api for owner@example.test'));
    const network = (await make().send(message).catch((e: Error) => e)) as Error;
    expect(network.message).not.toMatch(/owner@example|token=/);
  });
});
