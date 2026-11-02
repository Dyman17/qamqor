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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { AlertStatus, AlertType, AlertSeverity } from '@qamqor/shared';

@Controller('api/v1/alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  private resolveFarmId(user: AuthenticatedUser, headerFarmId?: string): string {
    const farmId = headerFarmId || user.farmId;
    if (!farmId) {
      throw new BadRequestException('ID хозяйства не указан');
    }
    return farmId;
  }

  @Get()
  async listAlerts(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-farm-id') headerFarmId?: string,
    @Query('status') status?: AlertStatus,
    @Query('type') type?: AlertType,
    @Query('severity') severity?: AlertSeverity,
    @Query('animalId') animalId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
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
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.alertsService.getAlertStats(user.id, farmId);
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') alertId: string,
    @Body('status') status: AlertStatus,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    if (!status || !Object.values(AlertStatus).includes(status)) {
      throw new BadRequestException('Некорректный статус оповещения');
    }
    return this.alertsService.updateAlertStatus(user.id, farmId, alertId, status);
  }
}
