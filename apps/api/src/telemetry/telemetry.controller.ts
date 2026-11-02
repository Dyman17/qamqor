import {
  Controller,
  Post,
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
}

