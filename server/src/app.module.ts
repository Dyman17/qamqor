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
import { SimulationModule } from './simulation/simulation.module';
import { MailModule } from './mail/mail.module';
import { validateEnv } from './config/env.validation';

// CameraModule is intentionally not mounted: there is no camera hardware yet (owner decision 2026-11-08).
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    MailModule,
    AuthModule,
    FarmsModule,
    AnimalsModule,
    DevicesModule,
    GeofenceModule,
    AlertsModule,
    TelemetryModule,
    AnalyticsModule,
    SimulationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
