import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class InjectTelemetryDto {
  @IsString()
  @IsNotEmpty({ message: 'Необходимо указать animalId или deviceId' })
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
  accuracy?: number;

  @IsOptional()
  @IsNumber()
  signal?: number;
}

export class SimulateActionDto {
  @IsString()
  @IsNotEmpty({ message: 'ID животного обязателен' })
  animalId!: string;
}
