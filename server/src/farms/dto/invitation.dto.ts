import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail({}, { message: 'Некорректный формат email' })
  @MaxLength(254)
  email!: string;

  /** Language of the invitation email. */
  @IsOptional()
  @IsIn(['kk', 'ru', 'en'])
  lang?: 'kk' | 'ru' | 'en';
}
