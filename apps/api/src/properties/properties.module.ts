import { Module } from '@nestjs/common';
import { OwnersController, PropertiesController } from './properties.controller';
import { OwnersService } from './owners.service';
import { PropertiesService } from './properties.service';

@Module({ controllers: [OwnersController, PropertiesController], providers: [OwnersService, PropertiesService] })
export class PropertiesModule {}
