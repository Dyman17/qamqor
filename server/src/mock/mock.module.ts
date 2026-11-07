import { Module } from '@nestjs/common';
import { MockController } from './mock.controller';
import { MockService } from './mock.service';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { CameraModule } from '../camera/camera.module';

@Module({
  imports: [TelemetryModule, CameraModule],
  controllers: [MockController],
  providers: [MockService],
  exports: [MockService],
})
export class MockModule {}

