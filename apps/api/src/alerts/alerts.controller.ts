import { Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { YearQuery } from '../compliance/dto';
import { Requires } from '../rbac/requires.decorator';
import { AlertsService } from './alerts.service';
import { DashboardService } from './dashboard.service';

@Controller()
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly dashboard: DashboardService,
  ) {}

  @Requires('booking:read')
  @Get('dashboard')
  get(@CurrentUser() user: AuthUser, @Query() q: YearQuery) {
    return this.dashboard.get(user, q.year);
  }

  @Requires('booking:read')
  @Get('alerts')
  list(@CurrentUser() user: AuthUser) {
    return this.alerts.list(user);
  }

  /** Staff see alerts; only Owner/Manager can close them. */
  @Requires('alert:resolve')
  @Patch('alerts/:id')
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.alerts.resolve(user, id, clientMeta(req));
  }
}
