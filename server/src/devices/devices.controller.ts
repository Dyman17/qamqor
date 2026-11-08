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

  @Post()
  @FarmRoles('OWNER')
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

  @Post(':id/rotate-secret')
  @FarmRoles('OWNER')
  async rotateSecret(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', DeviceIdPipe) deviceId: string,
    @FarmId() farmId: string,
  ) {
    return this.devicesService.rotateSecret(user.id, farmId, deviceId);
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

