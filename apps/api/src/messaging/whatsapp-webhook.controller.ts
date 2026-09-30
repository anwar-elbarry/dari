import { Controller, Get, HttpCode, NotFoundException, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { NoStore } from '../checkin/no-store.decorator';
import { SkipCsrf } from '../common/csrf.guard';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MessagingService } from './messaging.service';
import { parseStatusReports, verifySignature } from './signature';
import { WhatsAppEnabledGuard } from './whatsapp-enabled.guard';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Meta's callbacks. Both routes answer the same neutral 404 for anything that is not exactly right (wrong verify
 * token, missing or bad signature, webhook not configured), so nothing is learned by probing. The delivery report
 * is authenticated by its HMAC over the raw body, checked in constant time before the payload is read at all.
 */
@Controller('webhooks/whatsapp')
@UseGuards(WhatsAppEnabledGuard)
@NoStore()
export class WhatsAppWebhookController {
  constructor(
    private readonly messaging: MessagingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Registration handshake: echoes the challenge only for the configured verify token. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get()
  verify(@Query('hub.mode') mode?: unknown, @Query('hub.verify_token') token?: unknown, @Query('hub.challenge') challenge?: unknown) {
    const expected = this.config.WHATSAPP_VERIFY_TOKEN;
    if (!expected || mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string' || challenge.length > 200 || !/^[\w-]+$/.test(challenge) || !same(token, expected)) throw notFound();
    return challenge;
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request) {
    const secret = this.config.WHATSAPP_APP_SECRET;
    const body = req.body as unknown;
    if (!secret || !Buffer.isBuffer(body) || body.length === 0 || !verifySignature(body, req.header('x-hub-signature-256'), secret)) throw notFound();
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      throw notFound();
    }
    await this.messaging.applyReports(parseStatusReports(payload));
    return { ok: true };
  }
}
