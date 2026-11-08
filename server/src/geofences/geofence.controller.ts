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
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { PermissionsGuard } from '../farms/permissions.guard';
import { FarmRoles, RequireBoundaryEdit } from '../farms/roles.decorator';
import { FarmId } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/geofences')
@UseGuards(JwtAuthGuard, FarmAccessGuard, PermissionsGuard)
export class GeofenceController {
  constructor(private readonly geofenceService: GeofenceService) {}

  @Get()
  async listGeofences(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
  ) {
    return this.geofenceService.listGeofences(user.id, farmId);
  }

  @Get(':id')
  async getGeofence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') geofenceId: string,
    @FarmId() farmId: string,
  ) {
    return this.geofenceService.getGeofenceById(user.id, farmId, geofenceId);
  }

  @Post()
  @RequireBoundaryEdit()
  async createGeofence(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGeofenceInputDto,
    @FarmId() farmId: string,
  ) {
    return this.geofenceService.createGeofence(user.id, farmId, dto);
  }

  @Patch(':id')
  @RequireBoundaryEdit()
  async updateGeofence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') geofenceId: string,
    @Body() dto: UpdateGeofenceInputDto,
    @FarmId() farmId: string,
  ) {
    return this.geofenceService.updateGeofence(user.id, farmId, geofenceId, dto);
  }

  @Delete(':id')
  @FarmRoles('OWNER')
  async deleteGeofence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') geofenceId: string,
    @FarmId() farmId: string,
  ) {
    return this.geofenceService.deleteGeofence(user.id, farmId, geofenceId);
  }
}

