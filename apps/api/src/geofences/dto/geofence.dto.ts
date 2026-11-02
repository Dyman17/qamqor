import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateGeofenceInputDto {
  @IsString()
  @IsNotEmpty({ message: 'Название пастбища обязательно' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string; // Hex color, e.g. #10B981

  @IsObject({ message: 'Полигон должен быть валидным GeoJSON объектом' })
  @IsNotEmpty()
  polygonJson!: {
    type: 'Polygon';
    coordinates: number[][][]; // [[[lng, lat], [lng, lat], ...]]
  };
}

export class UpdateGeofenceInputDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsObject()
  polygonJson?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}
