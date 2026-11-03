import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { FarmsModule } from './farms/farms.module';
import { AnimalsModule } from './animals/animals.module';
import { DevicesModule } from './devices/devices.module';
import { GeofenceModule } from './geofences/geofence.module';
import { AlertsModule } from './alerts/alerts.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CameraModule } from './camera/camera.module';
import { MockModule } from './mock/mock.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AuthModule,
    FarmsModule,
    AnimalsModule,
    DevicesModule,
    GeofenceModule,
    AlertsModule,
    TelemetryModule,
    AnalyticsModule,
    CameraModule,
    MockModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
