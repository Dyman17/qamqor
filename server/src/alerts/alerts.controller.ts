import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { PermissionsGuard } from '../farms/permissions.guard';
import { FarmRoles, RequireBoundaryEdit } from '../farms/roles.decorator';
import { FarmId } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { AlertStatus, AlertType, AlertSeverity } from '@qamqor/shared';

@Controller('api/v1/alerts')
@UseGuards(JwtAuthGuard, FarmAccessGuard, PermissionsGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async listAlerts(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
    @Query('status') status?: AlertStatus,
    @Query('type') type?: AlertType,
    @Query('severity') severity?: AlertSeverity,
    @Query('animalId') animalId?: string,
  ) {
    return this.alertsService.listAlerts(user.id, farmId, {
      status,
      type,
      severity,
      animalId,
    });
  }

  @Get('stats')
  async getAlertStats(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
  ) {
    return this.alertsService.getAlertStats(user.id, farmId);
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') alertId: string,
    @Body('status') status: AlertStatus,
    @FarmId() farmId: string,
  ) {
    if (!status || !Object.values(AlertStatus).includes(status)) {
      throw new BadRequestException('Некорректный статус оповещения');
    }
    return this.alertsService.updateAlertStatus(user.id, farmId, alertId, status);
  }
}

