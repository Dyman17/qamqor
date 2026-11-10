import {
  Controller,
  Post,
  Get,
  Sse,
  MessageEvent,
  Query,
  Body,
  Header,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TelemetryService } from './telemetry.service';
import { DeviceTelemetryDto } from './dto/device-telemetry.dto';
import { DeviceTelemetryResponseDto } from '@qamqor/contracts';
import { DeviceAuthGuard, DEVICE_CODE_PATTERN } from '../devices/device-auth.guard';
import { CurrentDevice } from '../devices/current-device.decorator';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { FarmId } from '../farms/farm-context.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

const MIN = 60_000;

@Controller('api/v1/device')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  /**
   * Inspection endpoint: GET /api/v1/device/telemetry?code=12345678
   * Latest raw packets of a collar of the caller's farm (JWT + x-farm-id). 400 without an 8-digit code,
   * 404 when the device is unknown or belongs to another farm.
   */
  @Get('telemetry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, FarmAccessGuard, RateLimitGuard)
  @RateLimit(
    'device-telemetry-read',
    { limit: 60, windowMs: MIN, perUser: true, perIp: false },
    { limit: 120, windowMs: MIN },
  )
  async getLatestTelemetry(
    @FarmId() farmId: string,
    @Query('code') code?: string,
    @Query('limit') limitStr?: string,
  ) {
    if (typeof code !== 'string' || !DEVICE_CODE_PATTERN.test(code)) {
      throw new BadRequestException('code: exactly 8 digits are required');
    }
    const limit = Math.min(Math.max(parseInt(limitStr || '15', 10) || 15, 1), 50);
    return this.telemetryService.getLatestTelemetry(farmId, code, limit);
  }

  /**
   * Real-time Server-Sent Events (SSE) telemetry stream of the caller's farm:
   * GET /api/v1/device/stream[?code=12345678][&animalId=...]
   * Needs `Authorization: Bearer` and `x-farm-id` (EventSource cannot send headers: the web client uses
   * fetch + ReadableStream). Auth errors come back as normal JSON before the stream starts. An open stream
   * makes the farm "live" (collars ping fast). At most 5 streams per user (429).
   * Nest already sends no-store/no-transform and X-Accel-Buffering: no for SSE; they are also declared here.
   */
  @Sse('stream')
  @UseGuards(JwtAuthGuard, FarmAccessGuard)
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  streamTelemetry(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
    @Query('code') code?: string,
    @Query('animalId') animalId?: string,
  ): Observable<MessageEvent> {
    return this.telemetryService.openStream({ userId: user.id, farmId, code, animalId });
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
