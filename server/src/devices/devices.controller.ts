import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto, UpdateDeviceDto } from './dto/device.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  private resolveFarmId(user: AuthenticatedUser, headerFarmId?: string): string {
    const farmId = headerFarmId || user.farmId;
    if (!farmId) {
      throw new BadRequestException('ID хозяйства не указан');
    }
    return farmId;
  }

  @Get()
  async listDevices(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.devicesService.listDevices(user.id, farmId);
  }

  @Get(':id')
  async getDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') deviceId: string,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.devicesService.getDeviceById(user.id, farmId, deviceId);
  }

  @Post()
  async registerDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.devicesService.registerDevice(user.id, farmId, dto);
  }

  @Patch(':id')
  async updateDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') deviceId: string,
    @Body() dto: UpdateDeviceDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.devicesService.updateDevice(user.id, farmId, deviceId, dto);
  }

  @Delete(':id')
  async deleteDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') deviceId: string,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.devicesService.deleteDevice(user.id, farmId, deviceId);
  }
}

