import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { NoStore } from '../checkin/no-store.decorator';
import { Requires } from '../rbac/requires.decorator';
import { UpdateChecklistItemDto } from './checklist.dto';
import { ChecklistService } from './checklist.service';
import { MAX_DOCUMENT_BYTES } from './document-type';

const upload = () => FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1, fields: 0 } });

@Controller('properties/:id/checklist')
@NoStore()
export class ChecklistController {
  constructor(private readonly checklist: ChecklistService) {}

  /** Staff get the steps and their status only. */
  @Requires('checklist:read')
  @Get()
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string) {
    return this.checklist.list(user, propertyId);
  }

  @Requires('checklist:write')
  @Patch(':itemId')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateChecklistItemDto, @Req() req: Request) {
    return this.checklist.update(user, propertyId, itemId, dto, clientMeta(req));
  }

  @Requires('checklist:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':itemId/document')
  @HttpCode(200)
  @UseInterceptors(upload())
  attach(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @UploadedFile() file: { buffer: Buffer } | undefined, @Req() req: Request) {
    return this.checklist.attachDocument(user, propertyId, itemId, file?.buffer, clientMeta(req));
  }

  /** Never a URL: decrypted here after the audit row, sent as a download that our origin never renders. */
  @Requires('license_document:read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':itemId/document')
  @Header('Cross-Origin-Resource-Policy', 'same-origin')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { bytes, pdf } = await this.checklist.readDocument(user, propertyId, itemId, clientMeta(req));
    (req.res as Response).setHeader('Content-Disposition', `attachment; filename="${pdf ? 'document.pdf' : 'document.jpg'}"`);
    return new StreamableFile(bytes, { type: pdf ? 'application/pdf' : 'image/jpeg' });
  }

  @Requires('checklist:write')
  @Delete(':itemId/document')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    await this.checklist.removeDocument(user, propertyId, itemId, clientMeta(req));
  }
}
