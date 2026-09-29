import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright-core';
import { APP_CONFIG, AppConfig } from '../config/env';

export class PdfUnavailableError extends Error {
  constructor() {
    super('PDF rendering is unavailable');
  }
}

const MAX_PARALLEL = 2;
const RENDER_TIMEOUT_MS = 20_000;

/**
 * HTML to PDF with headless Chromium. Locked down because the HTML contains guest data:
 * JavaScript is off, the network is offline and every request is aborted (nothing can be fetched or exfiltrated),
 * service workers and downloads are blocked, and each render gets a fresh throw-away context. One browser process
 * is shared, at most two renders run at once, and failures surface as PdfUnavailableError (details are not logged:
 * an error message from the browser can quote the page).
 */
@Injectable()
export class PdfRenderer implements OnModuleDestroy {
  private readonly logger = new Logger('Pdf');
  private browser: Promise<Browser> | null = null;
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium
        .launch({
          headless: true,
          ...(this.config.PDF_CHROMIUM_PATH ? { executablePath: this.config.PDF_CHROMIUM_PATH } : {}),
          // Playwright turns Chromium's sandbox OFF unless asked: keep it on unless the deployment cannot provide one.
          chromiumSandbox: !this.config.PDF_NO_SANDBOX,
          args: ['--disable-gpu', '--disable-dev-shm-usage'],
        })
        .then((b) => {
          b.on('disconnected', () => {
            this.browser = null;
          });
          return b;
        })
        .catch(() => {
          this.browser = null;
          throw new PdfUnavailableError();
        });
    }
    return this.browser;
  }

  private async acquire() {
    if (this.running >= MAX_PARALLEL) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running += 1;
  }
  private release() {
    this.running -= 1;
    this.waiting.shift()?.();
  }

  async render(html: string): Promise<Buffer> {
    await this.acquire();
    try {
      const browser = await this.launch();
      const context = await browser.newContext({ javaScriptEnabled: false, offline: true, serviceWorkers: 'block', acceptDownloads: false });
      try {
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(RENDER_TIMEOUT_MS);
        await page.setContent(html, { waitUntil: 'load' });
        return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
      } finally {
        await context.close().catch(() => undefined);
      }
    } catch (e) {
      if (e instanceof PdfUnavailableError) throw e;
      this.logger.warn(`PDF rendering failed (${e instanceof Error ? e.name : 'error'})`);
      throw new PdfUnavailableError();
    } finally {
      this.release();
    }
  }

  async onModuleDestroy() {
    const b = this.browser;
    this.browser = null;
    await (await b?.catch(() => null))?.close().catch(() => undefined);
  }
}
