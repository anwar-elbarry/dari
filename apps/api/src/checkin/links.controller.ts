import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Requires } from '../rbac/requires.decorator';
import { CheckInEnabledGuard } from './checkin-enabled.guard';
import { CreateLinkDto } from './dto';
import { LinksService } from './links.service';
import { NoStore } from './no-store.decorator';

/** Staff can send links (`checkin:manage`); they never see a token again after it is created. */
@Controller()
@UseGuards(CheckInEnabledGuard)
@NoStore()
export class LinksController {
  constructor(private readonly links: LinksService) {}

  @Requires('checkin:manage')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('bookings/:id/checkin-links')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) bookingId: string, @Body() dto: CreateLinkDto, @Req() req: Request) {
    return this.links.create(user, bookingId, dto.maxGuests, clientMeta(req));
  }

  @Requires('checkin:manage')
  @Get('bookings/:id/checkin-links')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) bookingId: string) {
    return this.links.list(user, bookingId);
  }

  @Requires('checkin:manage')
  @Delete('checkin-links/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.links.revoke(user, id, clientMeta(req));
  }

  @Requires('checkin:manage')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('checkin-links/:id/resend')
  resend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.links.resend(user, id, clientMeta(req));
  }
}
