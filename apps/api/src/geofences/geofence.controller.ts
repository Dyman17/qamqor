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
import { GeofenceService } from './geofence.service';
import { CreateGeofenceInputDto, UpdateGeofenceInputDto } from './dto/geofence.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/geofences')
@UseGuards(JwtAuthGuard)
export class GeofenceController {
  constructor(private readonly geofenceService: GeofenceService) {}

  private resolveFarmId(user: AuthenticatedUser, headerFarmId?: string): string {
    const farmId = headerFarmId || user.farmId;
    if (!farmId) {
      throw new BadRequestException('ID хозяйства не указан');
    }
    return farmId;
  }

  @Get()
  async listGeofences(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.geofenceService.listGeofences(user.id, farmId);
  }

  @Get(':id')
  async getGeofence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') geofenceId: string,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.geofenceService.getGeofenceById(user.id, farmId, geofenceId);
  }

  @Post()
  async createGeofence(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGeofenceInputDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.geofenceService.createGeofence(user.id, farmId, dto);
  }

  @Patch(':id')
  async updateGeofence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') geofenceId: string,
    @Body() dto: UpdateGeofenceInputDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.geofenceService.updateGeofence(user.id, farmId, geofenceId, dto);
  }

  @Delete(':id')
  async deleteGeofence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') geofenceId: string,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.geofenceService.deleteGeofence(user.id, farmId, geofenceId);
  }
}
