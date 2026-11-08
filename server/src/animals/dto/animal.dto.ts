import {
  IsEnum,
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

