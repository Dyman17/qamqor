import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AnimalSpecies, AnimalGender } from '@prisma/client';
import { PageQueryDto } from '../../common/pagination';

const DEVICE_ID = /^[A-Za-z0-9_-]{3,40}$/;

export class CreateAnimalInputDto {
  @IsString()
  @IsNotEmpty({ message: 'Кличка или имя обязательно' })
  @MaxLength(120)
  name!: string;

  /** Ear tag; unique within the farm. */
  @IsString()
  @IsNotEmpty({ message: 'Номер бирки обязателен' })
  @MaxLength(60)
  tag!: string;

  @IsEnum(AnimalSpecies, { message: 'Некорректный вид животного' })
  species!: AnimalSpecies;

  @IsOptional()
  @IsEnum(AnimalGender)
  gender?: AnimalGender;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  breed?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  birthDate?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(500)
  photoUrl?: string;

  /** Pen (geofence) id; null = no border. Needs boundary rights. */
  @IsOptional()
  @IsUUID()
  penId?: string;

  /** Public collar id, e.g. "QAM-0005". */
  @IsOptional()
  @Matches(DEVICE_ID, { message: 'collarId: 3-40 символов (латиница, цифры, _ и -)' })
  collarId?: string;
}

export class UpdateAnimalInputDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  tag?: string;

  @IsOptional()
  @IsEnum(AnimalSpecies)
  species?: AnimalSpecies;

  @IsOptional()
  @IsEnum(AnimalGender)
  gender?: AnimalGender;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  breed?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  birthDate?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(500)
  photoUrl?: string;

  /** Pen id, or null to remove the border. Needs boundary rights. */
  @IsOptional()
  @IsUUID()
  penId?: string | null;

  /** Collar id, or null to detach the collar. */
  @IsOptional()
  @Matches(DEVICE_ID, { message: 'collarId: 3-40 символов (латиница, цифры, _ и -)' })
  collarId?: string | null;
}

export class AssignCollarDto {
  @IsString()
  @Matches(DEVICE_ID, { message: 'deviceId: 3-40 символов (латиница, цифры, _ и -)' })
  deviceId!: string;
}

export class SteerDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  animalIds!: string[];

  @IsUUID()
  targetPenId!: string;
}

export class ListAnimalsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(['ok', 'danger', 'warning', 'offline'])
  status?: 'ok' | 'danger' | 'warning' | 'offline';

  @IsOptional()
  @IsUUID()
  penId?: string;

  @IsOptional()
  @IsEnum(AnimalSpecies)
  species?: AnimalSpecies;
}

export class EventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit: целое число' })
  @Min(1)
  @Max(100)
  limit?: number;
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
