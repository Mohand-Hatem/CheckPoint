import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example: '3f9a1c0e5b7d4a62...64 hex characters',
    description: 'The refresh token returned by login or by the previous refresh. Single-use.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken!: string;
}
