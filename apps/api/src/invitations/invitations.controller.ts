import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { setSessionCookies } from '../auth/cookies';
import { CurrentUser, Public } from '../auth/decorators';
import { APP_CONFIG, AppConfig } from '../config/env';
import { Requires } from '../rbac/requires.decorator';
import { AcceptInvitationDto, CreateInvitationDto, InvitationTokenDto } from './dto';
import { InvitationsService } from './invitations.service';

const STRICT = { default: { limit: 10, ttl: 60_000 } };

@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Requires('team:manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvitationDto, @Req() req: Request) {
    return this.invitations.create(user, dto, clientMeta(req));
  }

  @Requires('team:manage')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.invitations.listPending(user);
  }

  @Requires('team:manage')
  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.invitations.revoke(user, id, clientMeta(req));
  }

  /** POST, not GET, so the token never appears in URLs or access logs. */
  @Public()
  @Throttle(STRICT)
  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: InvitationTokenDto) {
    return this.invitations.preview(dto.token);
  }

  @Public()
  @Throttle(STRICT)
  @Post('accept')
  @HttpCode(201)
  async accept(@Body() dto: AcceptInvitationDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setSessionCookies(res, this.config, await this.invitations.accept(dto, clientMeta(req)));
    return { ok: true };
  }
}
