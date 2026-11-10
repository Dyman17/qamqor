import { Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { GeofenceModule } from '../geofences/geofence.module';
import { AlertsModule } from '../alerts/alerts.module';
import { SignalsModule } from '../signals/signals.module';
import { RateLimitGuard, RateLimiterService } from '../common/rate-limit';
import { DeviceAuthGuard } from '../devices/device-auth.guard';
import { LiveViewersService } from './live-viewers.service';

@Module({
  imports: [GeofenceModule, AlertsModule, SignalsModule],
  controllers: [TelemetryController],
  providers: [TelemetryService, LiveViewersService, RateLimiterService, RateLimitGuard, DeviceAuthGuard],
  exports: [TelemetryService],
})
export class TelemetryModule {}
