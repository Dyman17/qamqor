import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { FarmsService } from './farms.service';
import { CreateFarmDto, UpdateFarmDto } from './dto/farm.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/farms')
@UseGuards(JwtAuthGuard)
export class FarmsController {
  constructor(private readonly farmsService: FarmsService) {}

  @Get()
  async listFarms(@CurrentUser() user: AuthenticatedUser) {
    return this.farmsService.listUserFarms(user.id);
  }

  @Get(':id')
  async getFarm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') farmId: string,
  ) {
    return this.farmsService.getFarmById(user.id, farmId);
  }

  @Post()
  async createFarm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFarmDto,
  ) {
    return this.farmsService.createFarm(user.id, dto);
  }

  @Patch(':id')
  async updateFarm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') farmId: string,
    @Body() dto: UpdateFarmDto,
  ) {
    return this.farmsService.updateFarm(user.id, farmId, dto);
  }
}
