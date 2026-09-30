import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Requires } from '../rbac/requires.decorator';
import { BookingsService } from './bookings.service';
import { AmountsDto, BookingsQuery, ClassifyDto, YearQuery } from './dto';

@Controller()
export class ComplianceController {
  constructor(private readonly bookings: BookingsService) {}

  @Requires('booking:read')
  @Get('properties/:id/day-counter')
  dayCounter(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Query() q: YearQuery) {
    return this.bookings.dayCounter(user, propertyId, q.year);
  }

  /** Staff get dates and classification only; revenue fields need revenue:read. */
  @Requires('booking:read')
  @Get('properties/:id/bookings')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Query() q: BookingsQuery) {
    return this.bookings.list(user, propertyId, q);
  }

  /** The figures the tax estimate reads. Audited by id; the amounts themselves are never written to the audit trail. */
  @Requires('booking:write')
  @Patch('bookings/:id/amounts')
  amounts(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AmountsDto, @Req() req: Request) {
    return this.bookings.updateAmounts(user, id, dto, clientMeta(req));
  }

  @Requires('booking:write')
  @Patch('bookings/:id/classification')
  classify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClassifyDto, @Req() req: Request) {
    return this.bookings.classify(user, id, dto, clientMeta(req));
  }
}
