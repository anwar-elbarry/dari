import { MailDriver, MailMessage } from './mail.types';
import { parseSender } from './sender';

type Message = MailMessage & { from: string };

const TIMEOUT_MS = 10_000;

/**
 * Posts to the provider's fixed API endpoint. The URL is ours, not user input, so plain fetch is fine here
 * (the safeFetch rule is for user-supplied URLs). Errors carry the HTTP status only: never the recipient,
 * the subject, the body (reset links) or the provider's response text.
 */
async function post(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error('Mail provider unreachable or timed out');
  }
  if (!res.ok) throw new Error(`Mail provider responded with HTTP ${res.status}`);
}

/** Brevo (Sendinblue), transactional API v3. Hosted in the EU. */
export class BrevoMailDriver implements MailDriver {
  constructor(private readonly apiKey: string) {}

  send(m: Message): Promise<void> {
    return post('https://api.brevo.com/v3/smtp/email', { 'api-key': this.apiKey }, {
      sender: parseSender(m.from),
      to: [{ email: m.to }],
      subject: m.subject,
      textContent: m.text,
    });
  }
}

/** Resend, emails API. */
export class ResendMailDriver implements MailDriver {
  constructor(private readonly apiKey: string) {}

  send(m: Message): Promise<void> {
    return post('https://api.resend.com/emails', { authorization: `Bearer ${this.apiKey}` }, {
      from: m.from,
      to: [m.to],
      subject: m.subject,
      text: m.text,
    });
  }
}
