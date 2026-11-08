import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { OfflineWatcherService } from './offline-watcher.service';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AlertsModule],
  controllers: [DevicesController],
  providers: [DevicesService, OfflineWatcherService],
  exports: [DevicesService],
})
export class DevicesModule {}
