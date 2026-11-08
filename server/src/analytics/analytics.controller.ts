import {
  Controller,
  Get,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { FarmId } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/analytics')
@UseGuards(JwtAuthGuard, FarmAccessGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
  ) {
    return this.analyticsService.getOverview(user.id, farmId);
  }
}

