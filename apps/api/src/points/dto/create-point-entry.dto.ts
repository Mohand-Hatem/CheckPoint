import { PointType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePointEntryDto {
  @IsUUID()
  employeeId!: string;

  @IsEnum(PointType)
  pointType!: PointType;

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
