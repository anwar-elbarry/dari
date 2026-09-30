import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { PreferredChannel } from '@prisma/client';
import type { Request } from 'express';
import { IsEnum, IsString, MaxLength, ValidateIf } from 'class-validator';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { NoStore } from '../checkin/no-store.decorator';
import { AnyRole } from '../rbac/requires.decorator';
import { PreferencesService } from './preferences.service';

export class SetPreferenceDto {
  @IsString()
  @MaxLength(60)
  alertType!: string;

  @IsEnum(PreferredChannel)
  channel!: PreferredChannel;
}

export class SetPhoneDto {
  /** `null` removes the number. */
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  phone!: string | null;
}

/** A user's own alert channels and WhatsApp number. Any signed-in role: it only ever touches the caller's own rows. */
@Controller('me')
@NoStore()
export class MessagingController {
  constructor(private readonly preferences: PreferencesService) {}

  @AnyRole()
  @Get('notification-preferences')
  get(@CurrentUser() user: AuthUser) {
    return this.preferences.get(user);
  }

  @AnyRole()
  @Put('notification-preferences')
  set(@CurrentUser() user: AuthUser, @Body() dto: SetPreferenceDto) {
    return this.preferences.set(user, dto.alertType, dto.channel);
  }

  @AnyRole()
  @Put('phone')
  setPhone(@CurrentUser() user: AuthUser, @Body() dto: SetPhoneDto, @Req() req: Request) {
    return this.preferences.setPhone(user, dto.phone, clientMeta(req));
  }
}
