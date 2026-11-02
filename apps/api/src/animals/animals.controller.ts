import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AnimalsService } from './animals.service';
import { CreateAnimalInputDto, UpdateAnimalInputDto } from './dto/animal.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { AnimalSpecies } from '@prisma/client';

@Controller('api/v1/animals')
@UseGuards(JwtAuthGuard)
export class AnimalsController {
  constructor(private readonly animalsService: AnimalsService) {}

  private resolveFarmId(user: AuthenticatedUser, headerFarmId?: string): string {
    const farmId = headerFarmId || user.farmId;
    if (!farmId) {
      throw new BadRequestException('ID хозяйства не указан');
    }
    return farmId;
  }

  @Get()
  async listAnimals(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-farm-id') headerFarmId?: string,
    @Query('species') species?: AnimalSpecies,
    @Query('isOutsideGeofence') isOutsideGeofence?: string,
    @Query('search') search?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.animalsService.listAnimals(user.id, farmId, {
      species,
      isOutsideGeofence:
        isOutsideGeofence !== undefined ? isOutsideGeofence === 'true' : undefined,
      search,
    });
  }

  @Get(':id')
  async getAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') animalId: string,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.animalsService.getAnimalById(user.id, farmId, animalId);
  }

  @Get(':id/track')
  async getAnimalTrack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') animalId: string,
    @Headers('x-farm-id') headerFarmId?: string,
    @Query('limit') limit?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.animalsService.getAnimalTrack(
      user.id,
      farmId,
      animalId,
      limit ? parseInt(limit, 10) : 100,
    );
  }

  @Post()
  async createAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAnimalInputDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = dto.farmId || this.resolveFarmId(user, headerFarmId);
    return this.animalsService.createAnimal(user.id, farmId, dto);
  }

  @Patch(':id')
  async updateAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') animalId: string,
    @Body() dto: UpdateAnimalInputDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.animalsService.updateAnimal(user.id, farmId, animalId, dto);
  }

  @Delete(':id')
  async deleteAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') animalId: string,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.animalsService.deleteAnimal(user.id, farmId, animalId);
  }
}

