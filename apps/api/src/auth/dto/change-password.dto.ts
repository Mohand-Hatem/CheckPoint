import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'Password123!', description: 'Your current (or one-time) password' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ example: 'BrandNew#Pass9', minLength: 8, description: 'The new password. Must differ from the current one.' })
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  newPassword!: string;
}

export class ChangePasswordResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Password changed. Please sign in again.' })
  message!: string;
}
