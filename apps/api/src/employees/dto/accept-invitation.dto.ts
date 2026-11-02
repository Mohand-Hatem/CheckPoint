import { IsHexadecimal, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsHexadecimal()
  @Length(64, 64)
  token!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  password!: string;
}
