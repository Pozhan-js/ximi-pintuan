import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PintuanController } from './pintuan.controller';
import { PintuanStore } from './pintuan.store';

@Module({ controllers: [HealthController, PintuanController], providers: [PintuanStore] })
export class AppModule {}
