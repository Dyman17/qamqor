import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Body,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { DeviceIdPipe } from './device-id.pipe';
import { RegisterDeviceDto, UpdateDeviceDto, TestSignalDto } from './dto/device.dto';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { PermissionsGuard } from '../farms/permissions.guard';
import { FarmRoles, RequireBoundaryEdit } from '../farms/roles.decorator';
import { FarmId } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';

const MIN = 60_000;
const HOUR = 60 * MIN;

@Controller('api/v1/devices')
@UseGuards(JwtAuthGuard, FarmAccessGuard, PermissionsGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  async listDevices(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
  ) {
    return this.devicesService.listDevices(user.id, farmId);
  }

  @Get(':id')
  async getDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', DeviceIdPipe) deviceId: string,
    @FarmId() farmId: string,
  ) {
    return this.devicesService.getDeviceById(user.id, farmId, deviceId);
  }

  /**
   * Claim by the 8-digit code. Rate limited (code guessing): per user 10/min and 60/h, per IP 30/min.
   * The RateLimitGuard runs after the class-level guards, so `request.user` is set.
   */
  @Post()
  @FarmRoles('OWNER')
  @UseGuards(RateLimitGuard)
  @RateLimit(
    'device-claim',
    { limit: 10, windowMs: MIN, perUser: true, perIp: false },
    { limit: 60, windowMs: HOUR, perUser: true, perIp: false },
    { limit: 30, windowMs: MIN },
  )
  async registerDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
    @FarmId() farmId: string,
  ) {
    return this.devicesService.registerDevice(user.id, farmId, dto);
  }

  @Patch(':id')
  async updateDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', DeviceIdPipe) deviceId: string,
    @Body() dto: UpdateDeviceDto,
    @FarmId() farmId: string,
  ) {
    return this.devicesService.updateDevice(user.id, farmId, deviceId, dto);
  }

  @Post(':id/test-signal')
  @HttpCode(HttpStatus.ACCEPTED)
  async testSignal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', DeviceIdPipe) deviceId: string,
    @Body() dto: TestSignalDto,
    @FarmId() farmId: string,
  ) {
    return this.devicesService.queueTestSignal(user.id, farmId, deviceId, dto);
  }

  @Delete(':id')
  @FarmRoles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', DeviceIdPipe) deviceId: string,
    @FarmId() farmId: string,
  ) {
    return this.devicesService.deleteDevice(user.id, farmId, deviceId);
  }
}

