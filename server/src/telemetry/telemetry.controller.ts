import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { DeviceTelemetryDto } from './dto/device-telemetry.dto';
import { DeviceTelemetryResponseDto } from '@qamqor/contracts';
import { DeviceAuthGuard } from '../devices/device-auth.guard';
import { CurrentDevice } from '../devices/current-device.decorator';

@Controller('api/v1/device')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Post('telemetry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceAuthGuard)
  async receiveTelemetry(
    @CurrentDevice() device: any,
    @Body() dto: DeviceTelemetryDto,
  ): Promise<DeviceTelemetryResponseDto> {
    return this.telemetryService.processDeviceTelemetry(device, dto);
  }
}
