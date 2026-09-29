import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/env';
import { ROLE_CAPABILITIES } from '../rbac/capabilities';
import { AnyRole } from '../rbac/requires.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { AuthUser, clientMeta } from './auth.types';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './cookies';
import { CurrentUser, Public } from './decorators';
import { ForgotPasswordDto, LoginDto, ResetPasswordDto, SignupDto } from './dto';

const STRICT = { default: { limit: 10, ttl: 60_000 } };

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/signup')
  @HttpCode(201)
  async signup(@Body() dto: SignupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setSessionCookies(res, this.config, await this.auth.signup(dto, clientMeta(req)));
    return { ok: true };
  }

  @Public()
  @Throttle(STRICT)
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setSessionCookies(res, this.config, await this.auth.login(dto, clientMeta(req)));
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setSessionCookies(res, this.config, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], clientMeta(req)));
    return { ok: true };
  }

  /** Public so a user with an expired access token can still end the session. */
  @Public()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], clientMeta(req));
    clearSessionCookies(res, this.config);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/forgot-password')
  @HttpCode(204)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto.email, clientMeta(req));
  }

  @Public()
  @Throttle(STRICT)
  @Post('auth/reset-password')
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.resetPassword(dto.token, dto.password, clientMeta(req));
    clearSessionCookies(res, this.config);
  }

  @AnyRole()
  @Get('me')
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: current.id },
      select: { id: true, name: true, email: true, role: true, account: { select: { id: true, companyName: true, subscriptionTier: true } } },
    });
    const { account, ...rest } = user;
    return { user: rest, account, capabilities: ROLE_CAPABILITIES[rest.role] };
  }
}
