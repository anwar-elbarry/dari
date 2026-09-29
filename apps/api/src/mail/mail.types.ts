export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Transport behind MailService. Production drivers: Brevo (EU) and Resend; the provider choice is an open decision. */
export interface MailDriver {
  send(message: MailMessage & { from: string }): Promise<void>;
}

export const MAIL_DRIVER = Symbol('MAIL_DRIVER');
