import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { DeviceTelemetryRequestDto } from '@qamqor/contracts';

export class DeviceTelemetryDto implements DeviceTelemetryRequestDto {
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsString()
  @IsNotEmpty()
  timestamp!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsNumber()
  @Min(0)
  accuracy!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  battery!: number;

  @IsOptional()
  @IsNumber()
  signal?: number;
}

