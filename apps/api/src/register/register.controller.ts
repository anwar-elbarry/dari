import { BadRequestException, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, PipeTransform, Post, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { NoStore } from '../checkin/no-store.decorator';
import { Requires } from '../rbac/requires.decorator';
import { PoliceRegisterEnabledGuard } from './police-register-enabled.guard';
import { parseMonth } from './register-month';
import { RegisterService } from './register.service';

class MonthPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!parseMonth(value)) throw new BadRequestException({ code: 'INVALID_MONTH', message: 'The month must look like 2026-10.' });
    return value;
  }
}

@Controller('properties/:id/registers')
@UseGuards(PoliceRegisterEnabledGuard)
@NoStore()
export class RegisterController {
  constructor(private readonly registers: RegisterService) {}

  /** Months with their status. Staff get the status only, Owner/Manager also the counts of incomplete records. */
  @Requires('booking:read')
  @Get()
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string) {
    return this.registers.list(user, propertyId);
  }

  /** The incomplete records of a month, by booking and guest id and problem. */
  @Requires('register:read')
  @Get(':month/validation')
  validation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('month', MonthPipe) month: string) {
    return this.registers.validation(user, propertyId, month);
  }

  @Requires('register:read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':month')
  @HttpCode(200)
  generate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('month', MonthPipe) month: string, @Req() req: Request) {
    return this.registers.generate(user, propertyId, month, clientMeta(req));
  }

  /** The PDF is never a URL: decrypted here, audited first, streamed with no-store. */
  @Requires('register:read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':month/pdf')
  @Header('Content-Disposition', 'inline; filename="registre-de-police.pdf"')
  @Header('Cross-Origin-Resource-Policy', 'same-origin')
  async pdf(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('month', MonthPipe) month: string, @Req() req: Request) {
    return new StreamableFile(await this.registers.pdf(user, propertyId, month, clientMeta(req)), { type: 'application/pdf' });
  }
}
