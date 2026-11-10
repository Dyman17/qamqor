import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { OfflineWatcherService } from './offline-watcher.service';
import { AlertsModule } from '../alerts/alerts.module';
import { RateLimitGuard, RateLimiterService } from '../common/rate-limit';

@Module({
  imports: [AlertsModule],
  controllers: [DevicesController],
  providers: [DevicesService, OfflineWatcherService, RateLimiterService, RateLimitGuard],
  exports: [DevicesService, OfflineWatcherService],
})
export class DevicesModule {}
