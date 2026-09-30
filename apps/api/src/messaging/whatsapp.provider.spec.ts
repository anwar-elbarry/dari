import { CloudWhatsAppProvider, StubWhatsAppProvider, WhatsAppProviderError } from './whatsapp.provider';

const message = { to: '+212612345678', name: 'checkin_link_v1', language: 'fr', variables: ['Riad  Atlas', 'https://x.test/checkin#token=SECRET'] };

describe('CloudWhatsAppProvider', () => {
  afterEach(() => jest.restoreAllMocks());
  const provider = new CloudWhatsAppProvider('123456789', 'token-token-token-token-token', 'v21.0');
  const respond = (status: number, body: unknown = {}) => jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('posts a template to the fixed host, without the "+" and with flattened variables', async () => {
    const spy = respond(200, { messages: [{ id: 'wamid.ABC' }] });
    expect(await provider.send(message)).toEqual({ providerMessageId: 'wamid.ABC' });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://graph.facebook.com/v21.0/123456789/messages');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ to: '212612345678', type: 'template', template: { name: 'checkin_link_v1', language: { code: 'fr' } } });
    expect(body.template.components[0].parameters[0]).toEqual({ type: 'text', text: 'Riad Atlas' });
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer token-token-token-token-token' });
  });

  it.each([[401, 'PROVIDER_AUTH'], [403, 'PROVIDER_AUTH'], [429, 'PROVIDER_RATE_LIMITED'], [400, 'PROVIDER_REJECTED'], [500, 'PROVIDER_UNREACHABLE'], [503, 'PROVIDER_UNREACHABLE']])('HTTP %i -> %s, and the message quotes nothing', async (status, code) => {
    respond(status, { error: { message: 'Recipient +212612345678 is not valid, token=SECRET' } });
    const error = await provider.send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppProviderError);
    expect((error as WhatsAppProviderError).code).toBe(code);
    expect(String((error as Error).message) + JSON.stringify(error)).not.toMatch(/212612345678|SECRET/);
  });

  it('a network failure, a timeout or an answer without a message id are failures', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED graph.facebook.com for +212612345678'));
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'PROVIDER_UNREACHABLE' });
    respond(200, { messages: [] });
    await expect(provider.send(message)).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' });
  });
});

describe('StubWhatsAppProvider', () => {
  it('records what it is given, numbers its ids, and fails on demand', async () => {
    const stub = new StubWhatsAppProvider();
    expect((await stub.send(message)).providerMessageId).toBe('wamid.stub-1');
    stub.failNext('PROVIDER_AUTH');
    await expect(stub.send(message)).rejects.toMatchObject({ code: 'PROVIDER_AUTH' });
    expect(stub.sent).toHaveLength(1);
  });
});
