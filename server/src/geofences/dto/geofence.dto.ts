import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsGeoJsonPolygon } from '../polygon';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export class CreateGeofenceInputDto {
  @IsString()
  @IsNotEmpty({ message: 'Название пастбища обязательно' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'color: HEX-цвет вида #10B981' })
  color?: string;

  @IsGeoJsonPolygon()
  polygon!: {
    type: 'Polygon';
    coordinates: number[][][]; // [[[lng, lat], [lng, lat], ...]]
  };

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  animalIds?: string[];
}

export class UpdateGeofenceInputDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'color: HEX-цвет вида #10B981' })
  color?: string;

  @IsOptional()
  @IsGeoJsonPolygon()
  polygon?: {
    type: 'Polygon';
    coordinates: number[][][];
  };

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  animalIds?: string[];
}
