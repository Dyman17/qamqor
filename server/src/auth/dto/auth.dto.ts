import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RegisterUserDto, LoginDto } from '@qamqor/contracts';
import { IsPasswordBytesMax } from '../../common/validators';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export class RegisterDto implements RegisterUserDto {
  @IsEmail({}, { message: 'Некорректный формат email' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Пароль должен содержать не менее ${PASSWORD_MIN} символов` })
  @MaxLength(PASSWORD_MAX, { message: `Пароль должен содержать не более ${PASSWORD_MAX} символов` })
  @IsPasswordBytesMax(PASSWORD_MAX)
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Имя обязательно для заполнения' })
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  farmName?: string;
}

export class LoginUserDto implements LoginDto {
  @IsEmail({}, { message: 'Некорректный формат email' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Пароль обязателен' })
  @MaxLength(128)
  password!: string;
}

export class PasswordResetRequestDto {
  @IsEmail({}, { message: 'Некорректный формат email' })
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsIn(['kk', 'ru', 'en'])
  lang?: 'kk' | 'ru' | 'en';
}

export class PasswordResetConfirmDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Пароль должен содержать не менее ${PASSWORD_MIN} символов` })
  @MaxLength(PASSWORD_MAX, { message: `Пароль должен содержать не более ${PASSWORD_MAX} символов` })
  @IsPasswordBytesMax(PASSWORD_MAX)
  newPassword!: string;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  /** Required for a new user only. */
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Пароль должен содержать не менее ${PASSWORD_MIN} символов` })
  @MaxLength(PASSWORD_MAX)
  @IsPasswordBytesMax(PASSWORD_MAX)
  password?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName?: string;
}
