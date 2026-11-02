import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({ example: false, description: 'false deactivates the user and revokes all their refresh tokens at once; true reactivates' })
  @IsBoolean()
  @IsNotEmpty()
  active!: boolean;
}
