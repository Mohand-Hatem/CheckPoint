import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsPositive,
  Max,
} from 'class-validator';

export class ConfigurePointValuesDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999999999999.99)
  greenEgp!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999999999999.99)
  redEgp!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999999999999.99)
  blackEgp!: number;

  @IsDateString({ strict: true })
  effectiveFrom!: string;
}
