import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { RegisterUserDto, LoginDto } from '@qamqor/contracts';

export class RegisterDto implements RegisterUserDto {
  @IsEmail({}, { message: 'Некорректный формат email' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'Пароль должен содержать не менее 6 символов' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Имя обязательно для заполнения' })
  fullName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  farmName?: string;
}

export class LoginUserDto implements LoginDto {
  @IsEmail({}, { message: 'Некорректный формат email' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Пароль обязателен' })
  password!: string;
}

