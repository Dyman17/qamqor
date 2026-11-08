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
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { PermissionsGuard } from '../farms/permissions.guard';
import { FarmRoles, RequireBoundaryEdit } from '../farms/roles.decorator';
import { FarmId, CanEditBoundaries } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { AnimalSpecies } from '@prisma/client';

@Controller('api/v1/animals')
@UseGuards(JwtAuthGuard, FarmAccessGuard, PermissionsGuard)
export class AnimalsController {
  constructor(private readonly animalsService: AnimalsService) {}

  @Get()
  async listAnimals(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
    @Query('species') species?: AnimalSpecies,
    @Query('isOutsideGeofence') isOutsideGeofence?: string,
    @Query('search') search?: string,
  ) {
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
    @FarmId() farmId: string,
  ) {
    return this.animalsService.getAnimalById(user.id, farmId, animalId);
  }

  @Get(':id/track')
  async getAnimalTrack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') animalId: string,
    @FarmId() farmId: string,
    @Query('limit') limit?: string,
  ) {
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
    @FarmId() farmId: string,
    @CanEditBoundaries() canEditBoundaries: boolean,
  ) {
    return this.animalsService.createAnimal(user.id, farmId, dto, canEditBoundaries);
  }

  @Patch(':id')
  async updateAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') animalId: string,
    @Body() dto: UpdateAnimalInputDto,
    @FarmId() farmId: string,
    @CanEditBoundaries() canEditBoundaries: boolean,
  ) {
    return this.animalsService.updateAnimal(user.id, farmId, animalId, dto, canEditBoundaries);
  }

  @Delete(':id')
  async deleteAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') animalId: string,
    @FarmId() farmId: string,
  ) {
    return this.animalsService.deleteAnimal(user.id, farmId, animalId);
  }
}

