import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser, clientMeta } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Requires } from '../rbac/requires.decorator';
import { CreateOwnerDto, CreatePropertyDto, UpdateOwnerDto, UpdatePropertyDto } from './dto';
import { OwnersService } from './owners.service';
import { PropertiesService } from './properties.service';

@Controller('property-owners')
export class OwnersController {
  constructor(private readonly owners: OwnersService) {}

  @Requires('owner:read')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.owners.list(user);
  }

  @Requires('owner:write')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOwnerDto, @Req() req: Request) {
    return this.owners.create(user, dto, clientMeta(req));
  }

  @Requires('owner:read')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.owners.get(user, id);
  }

  @Requires('owner:write')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOwnerDto, @Req() req: Request) {
    return this.owners.update(user, id, dto, clientMeta(req));
  }
}

@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  /** Staff get the reduced projection; Owner/Manager the full one. */
  @Requires('property:read')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.properties.list(user);
  }

  @Requires('property:write')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePropertyDto, @Req() req: Request) {
    return this.properties.create(user, dto, clientMeta(req));
  }

  @Requires('property:read')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.properties.get(user, id);
  }

  @Requires('property:write')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePropertyDto, @Req() req: Request) {
    return this.properties.update(user, id, dto, clientMeta(req));
  }
}
