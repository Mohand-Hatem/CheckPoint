import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateShiftVersionDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must use HH:mm 24-hour format',
  })
  startTime!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must use HH:mm 24-hour format',
  })
  endTime!: string;

  @IsInt()
  @Min(1)
  @Max(1439)
  graceMinutes!: number;

  @IsInt()
  @Min(1)
  @Max(1439)
  redPeriodMinutes!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays!: number[];

  @IsDateString({ strict: true })
  effectiveFrom!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString({ strict: true })
  effectiveTo?: string;
}
