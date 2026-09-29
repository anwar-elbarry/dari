import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Requires } from '../rbac/requires.decorator';
import { TEMPLATE_CSV } from './csv-import';
import { ImportBodyDto } from './dto';
import { ImportsService, MAX_UPLOAD_BYTES } from './imports.service';

const upload = () => FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 5 } });
type UploadedCsv = { buffer: Buffer; originalname: string; mimetype: string };

@Controller()
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Requires('booking:write')
  @Get('imports/template.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="riadtax-import-template.csv"')
  template() {
    return TEMPLATE_CSV;
  }

  @Requires('booking:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('properties/:id/imports/preview')
  @HttpCode(200)
  @UseInterceptors(upload())
  preview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @UploadedFile() file: UploadedCsv | undefined, @Body() body: ImportBodyDto) {
    return this.imports.preview(user, propertyId, file?.buffer, body.mapping);
  }

  @Requires('booking:write')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('properties/:id/imports')
  @HttpCode(201)
  @UseInterceptors(upload())
  commit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @UploadedFile() file: UploadedCsv | undefined, @Body() body: ImportBodyDto, @Req() req: Request) {
    return this.imports.commit(user, propertyId, file?.buffer, file?.originalname ?? 'import.csv', body.mapping, clientMeta(req));
  }
}

