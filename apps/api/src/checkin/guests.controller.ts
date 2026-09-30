import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Requires } from '../rbac/requires.decorator';
import { CheckInEnabledGuard } from './checkin-enabled.guard';
import { ArrivalsQuery, UpdateGuestDto } from './dto';
import { FicheService } from './fiche.service';
import { GuestsService } from './guests.service';
import { NoStore } from './no-store.decorator';

@Controller()
@UseGuards(CheckInEnabledGuard)
@NoStore()
export class GuestsController {
  constructor(
    private readonly guests: GuestsService,
    private readonly fiche: FicheService,
  ) {}

  /** Staff get status only; names appear for Owner/Manager. */
  @Requires('booking:read')
  @Get('properties/:id/arrivals')
  arrivals(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Query() q: ArrivalsQuery) {
    return this.guests.arrivals(user, propertyId, q.days);
  }

  @Requires('guest:read_meta')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('guests/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.guests.read(user, id, clientMeta(req));
  }

  @Requires('guest:write')
  @Patch('guests/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGuestDto, @Req() req: Request) {
    return this.guests.update(user, id, dto, clientMeta(req));
  }

  /** An ID image is never a URL: it is decrypted here, audited, and streamed with no-store. Owner/Manager only. */
  @Requires('id:read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('guests/:id/document')
  @Header('Content-Disposition', 'inline; filename="document.jpg"')
  @Header('Cross-Origin-Resource-Policy', 'same-origin')
  async document(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const bytes = await this.guests.document(user, id, clientMeta(req));
    return new StreamableFile(bytes, { type: 'image/jpeg' });
  }

  /** The Fiche PDF, decrypted here and audited. Owner/Manager only until counsel confirms Staff access. */
  @Requires('police:read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('guests/:id/fiche')
  @Header('Content-Disposition', 'attachment; filename="fiche-de-police.pdf"')
  @Header('Cross-Origin-Resource-Policy', 'same-origin')
  async ficheFile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return new StreamableFile(await this.fiche.read(user, id, clientMeta(req)), { type: 'application/pdf' });
  }

  /** After a correction: renders a new PDF and deletes the previous one. */
  @Requires('police:read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('guests/:id/fiche/regenerate')
  @HttpCode(200)
  regenerate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.fiche.regenerate(user, id, clientMeta(req));
  }
}
