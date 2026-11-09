import { Controller, Post, Get, Query, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { DeviceTelemetryDto } from './dto/device-telemetry.dto';
import { DeviceTelemetryResponseDto } from '@qamqor/contracts';
import { DeviceAuthGuard } from '../devices/device-auth.guard';
import { CurrentDevice } from '../devices/current-device.decorator';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';

const MIN = 60_000;

@Controller('api/v1/device')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  /**
   * Inspection endpoint: GET /api/v1/device/telemetry?code=12345678
   * Returns live raw telemetry packets and status so users can inspect the stream in browser or curl.
   */
  @Get('telemetry')
  @HttpCode(HttpStatus.OK)
  async getLatestTelemetry(
    @Query('code') code?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '15', 10) || 15, 1), 50);
    return this.telemetryService.getLatestTelemetry(code, limit);
  }

  /**
   * Ping of an ESP32, identified by its 8-digit code. The rate limits run before the lookup so that
   * guessing codes is slowed down: per IP, and per code (body `code` or the X-Device-Code header).
   * The response always carries the same `code` as the request.
   */
  @Post('telemetry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard, DeviceAuthGuard)
  @RateLimit(
    'device-telemetry',
    { limit: 300, windowMs: MIN },
    { limit: 120, windowMs: MIN, keyField: 'code', headerField: 'x-device-code', perIp: false },
  )
  async receiveTelemetry(
    @CurrentDevice() device: any,
    @Body() dto: DeviceTelemetryDto,
  ): Promise<DeviceTelemetryResponseDto> {
    const res = await this.telemetryService.processDeviceTelemetry(device, { ...dto, deviceId: device.deviceId });
    return { ...res, code: device.code };
  }
}
