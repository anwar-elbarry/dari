import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { clientMeta } from '../auth/auth.types';
import { Public } from '../auth/decorators';
import { CheckInEnabledGuard } from './checkin-enabled.guard';
import { LangQuery, SubmitDto, UploadBodyDto } from './dto';
import { MAX_UPLOAD_BYTES } from './image-sanitizer';
import { NoStore } from './no-store.decorator';
import { PublicCheckInService } from './public.service';

const TOKEN_HEADER = 'x-checkin-token';
const photo = () => FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 3, parts: 4 } });

/**
 * The guest flow: no login, the link is the credential. The token travels in the `X-Checkin-Token` header (the
 * link itself carries it in a URL fragment), so it is in no URL, access log or link-preview request.
 * Every failure of the token gives one neutral answer. Nothing here returns the stored image.
 */
@Public()
@Controller('checkin')
@UseGuards(CheckInEnabledGuard)
@NoStore()
export class PublicCheckInController {
  constructor(private readonly service: PublicCheckInService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  view(@Headers(TOKEN_HEADER) token: string | undefined, @Query() q: LangQuery) {
    return this.service.view(token, q.lang);
  }

  @Post('document')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(photo())
  upload(@Headers(TOKEN_HEADER) token: string | undefined, @UploadedFile() file: { buffer: Buffer } | undefined, @Body() body: UploadBodyDto) {
    return this.service.upload(token, file, body.draftId);
  }

  @Post('submit')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@Headers(TOKEN_HEADER) token: string | undefined, @Body() dto: SubmitDto, @Req() req: Request) {
    return this.service.submit(token, dto, clientMeta(req));
  }
}
