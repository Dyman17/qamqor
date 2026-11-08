import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class InjectTelemetryDto {
  /** Animal id (UUID) or the public collar id of a simulated collar. */
  @IsString()
  @IsNotEmpty({ message: 'Необходимо указать animalId или deviceId' })
  @MaxLength(64)
  animalId!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracy?: number;

  @IsOptional()
  @IsNumber()
  @Min(-130)
  @Max(0)
  signal?: number;
}

export class SimulateActionDto {
  @IsUUID()
  animalId!: string;
}
