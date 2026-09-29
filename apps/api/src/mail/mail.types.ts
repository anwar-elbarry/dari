export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Transport behind MailService. Production driver (Resend or Brevo) is an open decision — see docs/phase-1.md. */
export interface MailDriver {
  send(message: MailMessage & { from: string }): Promise<void>;
}

export const MAIL_DRIVER = Symbol('MAIL_DRIVER');
