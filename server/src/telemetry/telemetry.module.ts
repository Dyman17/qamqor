import { Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { GeofenceModule } from '../geofences/geofence.module';
import { AlertsModule } from '../alerts/alerts.module';
import { SignalsModule } from '../signals/signals.module';

@Module({
  imports: [GeofenceModule, AlertsModule, SignalsModule],
  controllers: [TelemetryController],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
