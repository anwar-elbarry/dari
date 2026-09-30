import { Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { NoStore } from '../checkin/no-store.decorator';
import { Requires } from '../rbac/requires.decorator';
import { ReportsQuery } from './dto';
import { TaxReportService } from './tax-report.service';
import { TaxReportsEnabledGuard } from './tax-reports-enabled.guard';
import { TaxRulesService } from './tax-rules.service';

/**
 * Monthly tax estimates. Owner/Manager generate; the Accountant reads (`report:read`) and never reaches a property,
 * an owner or a guest. Exports are decrypted here, audited first and never a URL.
 */
@Controller()
@UseGuards(TaxReportsEnabledGuard)
@NoStore()
export class TaxController {
  constructor(
    private readonly reports: TaxReportService,
    private readonly rules: TaxRulesService,
  ) {}

  /** Which parameters are in force and whether a fiduciaire validated them. */
  @Requires('report:read')
  @Get('tax/rules')
  ruleStatus() {
    return this.rules.status();
  }

  /** Newest first. `?year=` and `?propertyId=` narrow it; the answer is an array and `X-Truncated: true` says more exist than are shown. */
  @Requires('report:read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('tax/reports')
  async list(@CurrentUser() user: AuthUser, @Query() q: ReportsQuery, @Res({ passthrough: true }) res: Response) {
    const { reports, truncated } = await this.reports.list(user, q);
    if (truncated) res.setHeader('X-Truncated', 'true');
    return reports;
  }

  @Requires('report:read')
  @Get('tax/reports/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.detail(user, id);
  }

  @Requires('report:read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('tax/reports/:id/pdf')
  @Header('Content-Disposition', 'inline; filename="estimation-fiscale.pdf"')
  @Header('Cross-Origin-Resource-Policy', 'same-origin')
  async pdf(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return new StreamableFile(await this.reports.file(user, id, 'pdf', clientMeta(req)), { type: 'application/pdf' });
  }

  @Requires('report:read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('tax/reports/:id/xlsx')
  @Header('Content-Disposition', 'attachment; filename="estimation-fiscale.xlsx"')
  @Header('Cross-Origin-Resource-Policy', 'same-origin')
  async xlsx(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return new StreamableFile(await this.reports.file(user, id, 'xlsx', clientMeta(req)), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /** The months of one property with their status. */
  @Requires('report:generate')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('properties/:id/tax-reports')
  months(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string) {
    return this.reports.months(user, propertyId);
  }

  /** What is missing for a month: stays without amounts, rules not in force. Ids only. */
  @Requires('report:generate')
  @Get('properties/:id/tax-reports/:month/missing')
  missing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('month') month: string) {
    return this.reports.missing(user, propertyId, month);
  }

  @Requires('report:generate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('properties/:id/tax-reports/:month')
  @HttpCode(200)
  generate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) propertyId: string, @Param('month') month: string, @Req() req: Request) {
    return this.reports.generate(user, propertyId, month, clientMeta(req));
  }
}
