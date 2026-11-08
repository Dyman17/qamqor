import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DATA_MODES = ['REAL', 'MANUAL', 'AUTO'] as const;
export type DataModeName = (typeof DATA_MODES)[number];
export const SIM_SPEEDS = [1, 2, 5, 10] as const;
export const SIM_EVENTS = ['BREACH', 'ESCAPE', 'RETURN', 'GPS_LOST', 'COLLAR_OFFLINE', 'COLLAR_ONLINE'] as const;
export type SimEvent = (typeof SIM_EVENTS)[number];
export const SIM_SPECIES = ['HORSE', 'CAMEL', 'CATTLE', 'SHEEP', 'GOAT'] as const;

export class SetDataModeDto {
  @IsIn(DATA_MODES as unknown as string[])
  mode!: DataModeName;
}

export class StartSimulationDto {
  @IsOptional()
  @IsIn(SIM_SPEEDS as unknown as number[])
  speed?: 1 | 2 | 5 | 10;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  herd?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  hours?: number;
}

export class PatchSimulationDto {
  @IsOptional()
  @IsIn(SIM_SPEEDS as unknown as number[])
  speed?: 1 | 2 | 5 | 10;
}

export class SimulateAnimalDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsIn(SIM_SPECIES as unknown as string[])
  species?: (typeof SIM_SPECIES)[number];
}

export class SimulateTelemetryDto {
  @IsUUID()
  animalId!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  /** Default 5 m. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracyM?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(300)
  speedKmh?: number;
}

export class SimulateEventDto {
  @IsUUID()
  animalId!: string;

  @IsIn(SIM_EVENTS as unknown as string[])
  event!: SimEvent;
}
