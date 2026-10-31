import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    example: '3f9a1c0e5b7d4a62...64 hex characters',
    description:
      'The refresh token returned by login or by the previous refresh. Single-use. Required, except in cookie mode (header `X-Auth-Mode: cookie`), where it is read from the `cp_refresh` cookie.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken?: string;
}
