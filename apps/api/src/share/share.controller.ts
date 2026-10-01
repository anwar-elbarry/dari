import { Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser, Public } from '../auth/decorators';
import { NoStore } from '../checkin/no-store.decorator';
import { Requires } from '../rbac/requires.decorator';
import { CreateShareDto, RenewShareDto } from './dto';
import { SecureShareEnabledGuard } from './secure-share-enabled.guard';
import { ShareService } from './share.service';

const TOKEN_HEADER = 'x-share-token';

/** The manager's side: Owner/Manager only (`share:manage`). */
@Controller('shares')
@UseGuards(SecureShareEnabledGuard)
@NoStore()
export class SharesController {
  constructor(private readonly shares: ShareService) {}

  /** Returns the token and URL once; they are never shown again. */
  @Requires('share:manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShareDto, @Req() req: Request) {
    return this.shares.create(user, dto, clientMeta(req));
  }

  /** The bounds a manager may choose an expiry within, so the screen never hard-codes them. */
  @Requires('share:manage')
  @Get('lifetime')
  lifetime() {
    return this.shares.lifetime();
  }

  @Requires('share:manage')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.shares.list(user);
  }

  /** A new link (new token, shown once) for the same document: the first token can never be shown again. */
  @Requires('share:manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/renew')
  renew(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenewShareDto, @Req() req: Request) {
    return this.shares.renew(user, id, dto, clientMeta(req));
  }

  @Requires('share:manage')
  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.shares.revoke(user, id, clientMeta(req));
  }

  @Requires('share:manage')
  @Get(':id/access')
  access(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shares.accessLog(user, id);
  }
}

/**
 * The recipient's side: no account, the link is the credential. The token travels in `X-Share-Token` (the link
 * carries it in a URL fragment), so it is in no URL, access log or link-preview request. Every failure gives the
 * same 404. No cookie is read or set; the file is served inline, never cached, never indexed.
 */
@Public()
@Controller('share')
@UseGuards(SecureShareEnabledGuard)
@NoStore()
export class PublicShareController {
  constructor(private readonly shares: ShareService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async open(@Req() req: Request, @Headers(TOKEN_HEADER) token: string | undefined, @Headers('user-agent') ua: string | undefined, @Res({ passthrough: true }) res: Response) {
    // Express routes HEAD to this handler: it would count as an opening without delivering the file.
    if (req.method !== 'GET') throw new NotFoundException({ code: 'LINK_UNAVAILABLE', message: 'This link is not available.' });
    const { bytes } = await this.shares.open(token, ua);
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    return new StreamableFile(bytes, { type: 'application/pdf' });
  }
}
