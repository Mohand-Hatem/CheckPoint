import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';
import { Weekday, WEEKDAYS } from './calendar.service';

export class CreateHolidayDto {
  @ApiProperty({ example: '2026-12-25', description: 'Company-local date (YYYY-MM-DD).' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ example: 'Christmas' })
  @IsString()
  @MinLength(1)
  name!: string;
}

export class ListHolidaysQuery {
  @ApiPropertyOptional({ example: 2026, description: 'Only holidays in this calendar year.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class HolidayResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2026-12-25' })
  date!: string;

  @ApiProperty({ example: 'Christmas' })
  name!: string;
}

export class WeeklyOffDaysDto {
  @ApiProperty({
    enum: WEEKDAYS,
    isArray: true,
    example: ['FRI', 'SAT'],
    description: 'Days with no attendance expected; at least one day must remain a working day.',
  })
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn(WEEKDAYS, { each: true })
  days!: Weekday[];
}
