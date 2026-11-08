import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../auth/current-user.decorator';
import { SimulationService } from './simulation.service';
import {
  PatchSimulationDto,
  SetDataModeDto,
  SimulateAnimalDto,
  SimulateEventDto,
  SimulateTelemetryDto,
  StartSimulationDto,
} from './dto/simulation.dto';

/**
 * Demo modes of a farm. Like the other `/farms/:id/...` routes the farm is addressed by `:id` and the
 * service checks membership / the owner role itself (workers: FORBIDDEN_ROLE on every mutation).
 */
@Controller('api/v1/farms')
@UseGuards(JwtAuthGuard)
export class SimulationController {
  constructor(private readonly simulation: SimulationService) {}

  @Get(':id/simulation')
  async getSimulation(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) farmId: string) {
    return this.simulation.getState(user.id, farmId);
  }

  @Put(':id/data-mode')
  async setDataMode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) farmId: string,
    @Body() dto: SetDataModeDto,
  ) {
    return this.simulation.setMode(user.id, farmId, dto.mode);
  }

  @Post(':id/simulation/start')
  @HttpCode(HttpStatus.OK)
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) farmId: string,
    @Body() dto: StartSimulationDto,
  ) {
    return this.simulation.start(user.id, farmId, dto);
  }

  @Post(':id/simulation/stop')
  @HttpCode(HttpStatus.OK)
  async stop(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) farmId: string) {
    return this.simulation.stop(user.id, farmId);
  }

  @Post(':id/simulation/reset')
  @HttpCode(HttpStatus.OK)
  async reset(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) farmId: string) {
    return this.simulation.reset(user.id, farmId);
  }

  @Patch(':id/simulation')
  async patchSimulation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) farmId: string,
    @Body() dto: PatchSimulationDto,
  ) {
    return this.simulation.setSpeed(user.id, farmId, dto.speed);
  }

  @Post(':id/simulate/animals')
  async simulateAnimal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) farmId: string,
    @Body() dto: SimulateAnimalDto,
  ) {
    return this.simulation.createAnimal(user.id, farmId, dto);
  }

  @Post(':id/simulate/telemetry')
  @HttpCode(HttpStatus.OK)
  async simulateTelemetry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) farmId: string,
    @Body() dto: SimulateTelemetryDto,
  ) {
    return this.simulation.simulateTelemetry(user.id, farmId, dto);
  }

  @Post(':id/simulate/events')
  @HttpCode(HttpStatus.OK)
  async simulateEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) farmId: string,
    @Body() dto: SimulateEventDto,
  ) {
    return this.simulation.simulateEvent(user.id, farmId, dto);
  }
}
