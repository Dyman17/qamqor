import {
  Controller,
  Get,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  private resolveFarmId(user: AuthenticatedUser, headerFarmId?: string): string {
    const farmId = headerFarmId || user.farmId;
    if (!farmId) {
      throw new BadRequestException('ID хозяйства не указан');
    }
    return farmId;
  }

  @Get('overview')
  async getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.analyticsService.getOverview(user.id, farmId);
  }
}
