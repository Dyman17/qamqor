import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FarmsService } from './farms.service';
import { CreateFarmDto, UpdateFarmDto } from './dto/farm.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { parseSignalLimits } from './signal-limits';

/**
 * Farm routes address the farm by `:id` (not by x-farm-id); the service checks
 * membership/role itself (owner-only routes: FORBIDDEN_ROLE for workers).
 */
@Controller('api/v1/farms')
@UseGuards(JwtAuthGuard)
export class FarmsController {
  constructor(private readonly farmsService: FarmsService) {}

  @Get()
  async listFarms(@CurrentUser() user: AuthenticatedUser) {
    return this.farmsService.listUserFarms(user.id);
  }

  @Post()
  async createFarm(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFarmDto) {
    return this.farmsService.createFarm(user.id, dto);
  }

  @Get(':id')
  async getFarm(@CurrentUser() user: AuthenticatedUser, @Param('id') farmId: string) {
    return this.farmsService.getFarmById(user.id, farmId);
  }

  @Patch(':id')
  async updateFarm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') farmId: string,
    @Body() dto: UpdateFarmDto,
  ) {
    return this.farmsService.updateFarm(user.id, farmId, dto);
  }

  @Get(':id/members')
  async listMembers(@CurrentUser() user: AuthenticatedUser, @Param('id') farmId: string) {
    return this.farmsService.listMembers(user.id, farmId);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') farmId: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.farmsService.removeMember(user.id, farmId, targetUserId);
  }

  @Get(':id/signal-limits')
  async getSignalLimits(@CurrentUser() user: AuthenticatedUser, @Param('id') farmId: string) {
    return this.farmsService.getSignalLimits(user.id, farmId);
  }

  @Put(':id/signal-limits')
  async putSignalLimits(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') farmId: string,
    @Body() body: unknown,
  ) {
    return this.farmsService.putSignalLimits(user.id, farmId, parseSignalLimits(body));
  }
}
