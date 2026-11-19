import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PointType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class MyPointsSummaryQuery {
  @ApiPropertyOptional({ example: '2026-11', description: 'Payroll month of the points (YYYY-MM); default: the current company month.' })
  @IsOptional()
  @Matches(MONTH, { message: 'month must be YYYY-MM' })
  month?: string;
}

export class MyPointsQuery extends MyPointsSummaryQuery {
  @ApiPropertyOptional({ enum: PointType })
  @IsOptional()
  @IsEnum(PointType)
  type?: PointType;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class MyPointDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PointType })
  pointType!: PointType;

  @ApiProperty({ example: '2026-11-02', description: 'The day the point belongs to; decides its payroll month.' })
  workDate!: string;

  @ApiProperty({ example: 1, description: 'Points in this entry (overtime can give several GREENs at once).' })
  quantity!: number;

  @ApiProperty({ example: 'ATTENDANCE', description: 'ATTENDANCE, OVERTIME, EARLY_CHECKOUT or ADMIN.' })
  sourceType!: string;

  @ApiProperty({ nullable: true, example: 'Attendance check-in classified as GREEN.' })
  reason!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'Reversed by an admin or a correction; it counts for nothing.' })
  reversed!: boolean;

  @ApiProperty({ description: 'Its payroll month is closed.' })
  monthLocked!: boolean;

  @ApiProperty({ description: 'GREEN: points used to cancel penalties.' })
  consumedQty!: number;

  @ApiProperty({ description: 'RED / BLACK: points cancelled by GREENs.' })
  cancelledQty!: number;

  @ApiProperty({ description: 'GREEN: still free in an open month.' })
  availableQty!: number;

  @ApiProperty({ description: 'GREEN: unused when its month was locked (settled to the Fund).' })
  settledQty!: number;

  @ApiProperty({ description: 'RED / BLACK: still counting against you.' })
  activeQty!: number;
}

class PaginationDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class MyPointsResponseDto {
  @ApiProperty({ example: '2026-11' })
  month!: string;

  @ApiProperty({ type: [MyPointDto] })
  items!: MyPointDto[];

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

class GreenSummaryDto {
  @ApiProperty() total!: number;
  @ApiProperty() available!: number;
  @ApiProperty() consumed!: number;
  @ApiProperty() settled!: number;
}

class PenaltySummaryDto {
  @ApiProperty() total!: number;
  @ApiProperty() active!: number;
  @ApiProperty() cancelled!: number;
}

class WhiteSummaryDto {
  @ApiProperty() total!: number;
}

export class MyPointsSummaryDto {
  @ApiProperty({ example: '2026-11' })
  month!: string;

  @ApiProperty({ type: GreenSummaryDto })
  green!: GreenSummaryDto;

  @ApiProperty({ type: PenaltySummaryDto })
  red!: PenaltySummaryDto;

  @ApiProperty({ type: PenaltySummaryDto })
  black!: PenaltySummaryDto;

  @ApiProperty({ type: WhiteSummaryDto, description: 'WHITE is shown only; it never cancels or costs anything.' })
  white!: WhiteSummaryDto;
}
