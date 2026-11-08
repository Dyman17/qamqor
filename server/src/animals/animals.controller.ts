import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { AnimalsService } from './animals.service';
import {
  CreateAnimalInputDto,
  UpdateAnimalInputDto,
  TrackQueryDto,
  TRACK_DEFAULT_LIMIT,
  AssignCollarDto,
  SteerDto,
  ListAnimalsQueryDto,
  EventsQueryDto,
} from './dto/animal.dto';
import { SignalsService } from '../signals/signals.service';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { PermissionsGuard } from '../farms/permissions.guard';
import { RequireBoundaryEdit } from '../farms/roles.decorator';
import { FarmId, CanEditBoundaries } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

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
    @Query() query: ListAnimalsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const page = await this.animalsService.listAnimals(user.id, farmId, query);
    if (page.nextCursor) res.setHeader('X-Next-Cursor', page.nextCursor);
    return page.items;
  }

  /** Group move to another pen. Declared before the `:id` routes. */
  @Post('steer')
  @HttpCode(HttpStatus.OK)
  @RequireBoundaryEdit()
  async steer(@CurrentUser() user: AuthenticatedUser, @FarmId() farmId: string, @Body() dto: SteerDto) {
    return this.animalsService.steer(user.id, farmId, dto);
  }

  @Get(':id')
  async getAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) animalId: string,
    @FarmId() farmId: string,
  ) {
    return this.animalsService.getAnimalById(user.id, farmId, animalId);
  }

  /** Signals delivered to the animal today (farm time zone) against the daily limits. */
  @Get(':id/signals')
  async getAnimalSignals(@Param('id', ParseUUIDPipe) animalId: string, @FarmId() farmId: string) {
    await this.animalsService.ensureInFarm(farmId, animalId); // 404 for foreign animals
    return this.signalsService.daySummary(farmId, animalId);
  }

  /** Recent alerts of the animal plus today's signal counters. */
  @Get(':id/events')
  async getAnimalEvents(
    @Param('id', ParseUUIDPipe) animalId: string,
    @FarmId() farmId: string,
    @Query() query: EventsQueryDto,
  ) {
    const alerts = await this.animalsService.recentAlerts(farmId, animalId, query.limit ?? 20);
    const signals = await this.signalsService.daySummary(farmId, animalId);
    return { alerts, signals };
  }

  @Get(':id/track')
  async getAnimalTrack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) animalId: string,
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

  @Post(':id/assign-collar')
  @HttpCode(HttpStatus.OK)
  async assignCollar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) animalId: string,
    @Body() dto: AssignCollarDto,
    @FarmId() farmId: string,
  ) {
    return this.animalsService.assignCollar(user.id, farmId, animalId, dto.deviceId);
  }

  @Post(':id/unassign-collar')
  @HttpCode(HttpStatus.OK)
  async unassignCollar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) animalId: string,
    @FarmId() farmId: string,
  ) {
    return this.animalsService.unassignCollar(user.id, farmId, animalId);
  }

  @Patch(':id')
  async updateAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) animalId: string,
    @Body() dto: UpdateAnimalInputDto,
    @FarmId() farmId: string,
    @CanEditBoundaries() canEditBoundaries: boolean,
  ) {
    return this.animalsService.updateAnimal(user.id, farmId, animalId, dto, canEditBoundaries);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) animalId: string,
    @FarmId() farmId: string,
  ) {
    await this.animalsService.deleteAnimal(user.id, farmId, animalId);
  }
}
