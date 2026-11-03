import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { DeviceTelemetryDto } from './dto/device-telemetry.dto';
import { DeviceTelemetryResponseDto } from '@qamqor/contracts';

@Controller('api/v1/device')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Post('telemetry')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async receiveTelemetry(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: DeviceTelemetryDto,
  ): Promise<DeviceTelemetryResponseDto> {
    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    return this.telemetryService.processDeviceTelemetry(token, dto);
  }

  @Post('buzzer')
  @HttpCode(HttpStatus.OK)
  setBuzzerState(
    @Body() body: { deviceId?: string; buzzer: boolean },
  ) {
    const deviceId = body.deviceId || 'QAM-0001';
    const isBuzzerOn = Boolean(body.buzzer);
    this.telemetryService.setManualOverride(
      deviceId,
      {
        latitude: isBuzzerOn ? 43.6000 : 43.6501,
        longitude: isBuzzerOn ? 51.1000 : 51.1572,
        isOutside: isBuzzerOn,
        active: true,
      },
      60 * 60 * 1000,
    );

    return {
      success: true,
      deviceId,
      buzzer: isBuzzerOn,
      message: isBuzzerOn ? 'Buzzer turned ON' : 'Buzzer turned OFF',
    };
  }

  @Get('buzzer')
  getBuzzerDefault() {
    return this.getBuzzerState('QAM-0001');
  }

  @Get('buzzer/:deviceId')
  getBuzzerState(@Param('deviceId') paramDeviceId: string) {
    const deviceId = paramDeviceId || 'QAM-0001';
    const override = this.telemetryService.getManualOverride(deviceId);
    return {
      deviceId,
      buzzer: override?.active ? override.isOutside : false,
    };
  }
}

