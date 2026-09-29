import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAIL_DIR = process.env.E2E_MAIL_DIR ?? '/tmp/dari-e2e-mail';

/** Latest link sent to `to` by the API's file mail driver. */
export async function lastLink(to: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = safeList(MAIL_DIR).sort().reverse();
    for (const f of files) {
      const msg = JSON.parse(readFileSync(join(MAIL_DIR, f), 'utf8')) as { to: string; text: string };
      if (msg.to === to) {
        const link = msg.text.match(/https?:\/\/\S+[?#]token=[A-Za-z0-9_-]+/)?.[0];
        if (link) return link;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No mail with a link for ${to}`);
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}
