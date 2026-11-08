import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { AlertsService } from './alerts.service';
import { ListAlertsQueryDto, UpdateAlertStatusDto } from './dto/alerts.dto';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { PermissionsGuard } from '../farms/permissions.guard';
import { FarmId } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/alerts')
@UseGuards(JwtAuthGuard, FarmAccessGuard, PermissionsGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async listAlerts(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
    @Query() query: ListAlertsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const page = await this.alertsService.listAlerts(user.id, farmId, query);
    if (page.nextCursor) res.setHeader('X-Next-Cursor', page.nextCursor);
    return page.items;
  }

  @Get('stats')
  async getAlertStats(@CurrentUser() user: AuthenticatedUser, @FarmId() farmId: string) {
    return this.alertsService.getAlertStats(user.id, farmId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async readAll(@CurrentUser() user: AuthenticatedUser, @FarmId() farmId: string) {
    return this.alertsService.markAllRead(user.id, farmId);
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) alertId: string,
    @Body() dto: UpdateAlertStatusDto,
    @FarmId() farmId: string,
  ) {
    return this.alertsService.updateAlertStatus(user.id, farmId, alertId, dto.status);
  }
}
