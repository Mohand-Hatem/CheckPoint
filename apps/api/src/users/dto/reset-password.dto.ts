import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'Temp-Pass-2026',
    minLength: 6,
    description: 'One-time password the Admin hands to the user; they must replace it at first sign-in.',
  })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;
}

export class ResetPasswordResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: true, description: 'Always true: the user must set their own password next.' })
  mustChangePassword!: boolean;

  @ApiProperty({ example: 2, description: 'Sessions (refresh tokens) that were ended.' })
  sessionsRevoked!: number;
}
