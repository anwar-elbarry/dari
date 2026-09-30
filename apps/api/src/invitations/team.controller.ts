import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Requires } from '../rbac/requires.decorator';
import { UpdateMemberDto } from './team.dto';
import { TeamService } from './team.service';

@Controller('users')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Requires('team:manage')
  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.team.overview(user);
  }

  @Requires('team:manage')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto, @Req() req: Request) {
    return this.team.update(user, id, dto, clientMeta(req));
  }
}
