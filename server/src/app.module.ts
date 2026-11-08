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
import { MailModule } from './mail/mail.module';
import { validateEnv } from './config/env.validation';

const devOnlyModules = process.env.NODE_ENV === 'production' ? [] : [MockModule];

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
    CameraModule,
    ...devOnlyModules,
  ],
  controllers: [AppController],
})
export class AppModule {}
