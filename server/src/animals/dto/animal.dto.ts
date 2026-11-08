import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  Max,
  Min,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AnimalSpecies, AnimalGender } from '@prisma/client';

export class CreateAnimalInputDto {
  @IsString()
  @IsNotEmpty({ message: 'Кличка или имя обязательно' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Номер бирки обязателен' })
  tagNumber!: string;

  @IsEnum(AnimalSpecies, { message: 'Некорректный вид животного' })
  species!: AnimalSpecies;

  @IsOptional()
  @IsEnum(AnimalGender)
  gender?: AnimalGender;

  @IsOptional()
  @IsString()
  breed?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsUUID()
  activeGeofenceId?: string;
}

export class UpdateAnimalInputDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  tagNumber?: string;

  @IsOptional()
  @IsEnum(AnimalSpecies)
  species?: AnimalSpecies;

  @IsOptional()
  @IsEnum(AnimalGender)
  gender?: AnimalGender;

  @IsOptional()
  @IsString()
  breed?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  deviceId?: string | null;

  @IsOptional()
  @IsUUID()
  activeGeofenceId?: string | null;
}


export const TRACK_DEFAULT_LIMIT = 100;
export const TRACK_MAX_LIMIT = 500;

/** Query of GET /animals/:id/track. limit: integer 1-500 (default 100); from/to: ISO 8601. */
export class TrackQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit: целое число' })
  @Min(1)
  @Max(TRACK_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
