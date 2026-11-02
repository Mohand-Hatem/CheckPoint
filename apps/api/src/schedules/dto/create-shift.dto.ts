import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateShiftVersionDto } from './create-shift-version.dto';

export class CreateShiftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ValidateNested()
  @Type(() => CreateShiftVersionDto)
  version!: CreateShiftVersionDto;
}
