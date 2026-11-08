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
import { SignalsService } from '../signals/signals.service';
import { CreateAnimalInputDto, UpdateAnimalInputDto, TrackQueryDto, TRACK_DEFAULT_LIMIT } from './dto/animal.dto';
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
  constructor(
    private readonly animalsService: AnimalsService,
    private readonly signalsService: SignalsService,
  ) {}

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

  /** Signals delivered to the animal today (farm time zone) against the daily limits. */
  @Get(':id/signals')
  async getAnimalSignals(@Param('id') animalId: string, @FarmId() farmId: string) {
    await this.animalsService.ensureInFarm(farmId, animalId); // 404 for foreign animals
    return this.signalsService.daySummary(farmId, animalId);
  }

  @Get(':id/track')
  async getAnimalTrack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') animalId: string,
    @FarmId() farmId: string,
    @Query() query: TrackQueryDto,
  ) {
    return this.animalsService.getAnimalTrack(user.id, farmId, animalId, {
      limit: query.limit ?? TRACK_DEFAULT_LIMIT,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
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

