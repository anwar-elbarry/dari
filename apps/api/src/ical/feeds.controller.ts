import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Requires } from '../rbac/requires.decorator';
import { CreateFeedDto, UpdateFeedDto } from './dto';
import { FeedsService } from './feeds.service';

@Controller('properties/:id/feeds')
export class FeedsController {
  constructor(private readonly feeds: FeedsService) {}

  @Requires('ical:manage')
  @Get()
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string) {
    return this.feeds.list(user, propertyId);
  }

  @Requires('ical:manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Body() dto: CreateFeedDto, @Req() req: Request) {
    return this.feeds.create(user, propertyId, dto, clientMeta(req));
  }

  @Requires('ical:manage')
  @Patch(':feedId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) propertyId: string,
    @Param('feedId', ParseUUIDPipe) feedId: string,
    @Body() dto: UpdateFeedDto,
    @Req() req: Request,
  ) {
    return this.feeds.update(user, propertyId, feedId, dto, clientMeta(req));
  }

  @Requires('ical:manage')
  @Delete(':feedId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('feedId', ParseUUIDPipe) feedId: string, @Req() req: Request) {
    await this.feeds.remove(user, propertyId, feedId, clientMeta(req));
  }

  /** Each call downloads a user-supplied URL: kept rare. */
  @Requires('ical:manage')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post(':feedId/sync')
  @HttpCode(200)
  syncNow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('feedId', ParseUUIDPipe) feedId: string) {
    return this.feeds.syncNow(user, propertyId, feedId);
  }
}
