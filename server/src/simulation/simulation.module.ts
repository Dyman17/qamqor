import { Module } from '@nestjs/common';
import { FarmsModule } from '../farms/farms.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { DevicesModule } from '../devices/devices.module';
import { SimulationController } from './simulation.controller';
import { SimulationService } from './simulation.service';
import { SimulatorService } from './simulator.service';
import { DemoDataService } from './demo-data.service';

/** Demo modes (MANUAL pilot / AUTO simulation). Mounted in every environment; DEMO_MODES_ENABLED switches it off. */
@Module({
  imports: [FarmsModule, TelemetryModule, DevicesModule],
  controllers: [SimulationController],
  providers: [SimulationService, SimulatorService, DemoDataService],
})
export class SimulationModule {}
