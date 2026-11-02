import { Module } from '@nestjs/common';
import { GeofenceController } from './geofence.controller';
import { GeofenceService } from './geofence.service';

@Module({
  controllers: [GeofenceController],
  providers: [GeofenceService],
  exports: [GeofenceService],
})
export class GeofenceModule {}
