import { templateVariable } from './phone';

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

/** Fixed codes: the only thing a failure carries. Never the provider's text, the number, the template variables or a link. */
export type ProviderFailure = 'PROVIDER_UNREACHABLE' | 'PROVIDER_AUTH' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_REJECTED';

export class WhatsAppProviderError extends Error {
  constructor(readonly code: ProviderFailure) {
    super(code);
  }
}

export interface OutgoingTemplate {
  /** E.164 with the leading "+". */
  to: string;
  name: string;
  language: string;
  /** Positional body variables, already flattened (see `templateVariable`). */
  variables: string[];
}

export interface WhatsAppProvider {
  send(message: OutgoingTemplate): Promise<{ providerMessageId: string }>;
}

/** Development and tests only (refused in production by env validation): sends nothing, keeps what it was given so tests can look. */
export class StubWhatsAppProvider implements WhatsAppProvider {
  readonly sent: OutgoingTemplate[] = [];
  private failures: ProviderFailure[] = [];
  private seq = 0;

  failNext(code: ProviderFailure = 'PROVIDER_UNREACHABLE') {
    this.failures.push(code);
  }

  /** For tests: forget failures that were queued but never used. */
  reset() {
    this.failures = [];
    this.sent.length = 0;
  }

  async send(message: OutgoingTemplate) {
    const failure = this.failures.shift();
    if (failure) throw new WhatsAppProviderError(failure);
    this.sent.push(message);
    return { providerMessageId: `wamid.stub-${++this.seq}` };
  }
}

const TIMEOUT_MS = 10_000;

/**
 * Meta's WhatsApp Cloud API. The host is fixed (ours, not user input), so plain fetch is fine here. Business-initiated
 * messages must use an approved template; the app only ever sends a template name and its variables. Errors carry a
 * fixed code from the HTTP status: the response text can quote the recipient and is never read.
 */
export class CloudWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly apiVersion: string,
  ) {}

  async send(m: OutgoingTemplate): Promise<{ providerMessageId: string }> {
    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${encodeURIComponent(this.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.accessToken}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: m.to.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: m.name,
            language: { code: m.language },
            components: m.variables.length ? [{ type: 'body', parameters: m.variables.map((v) => ({ type: 'text', text: templateVariable(v) })) }] : [],
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new WhatsAppProviderError('PROVIDER_UNREACHABLE');
    }
    if (res.status === 401 || res.status === 403) throw new WhatsAppProviderError('PROVIDER_AUTH');
    if (res.status === 429) throw new WhatsAppProviderError('PROVIDER_RATE_LIMITED');
    if (res.status >= 500) throw new WhatsAppProviderError('PROVIDER_UNREACHABLE');
    if (!res.ok) throw new WhatsAppProviderError('PROVIDER_REJECTED');
    const id = ((await res.json().catch(() => null)) as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) throw new WhatsAppProviderError('PROVIDER_REJECTED');
    return { providerMessageId: id };
  }
}
