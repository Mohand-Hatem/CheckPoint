import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateAttendanceExcuseDto {
  @ApiProperty({ example: "The bus broke down on the ring road.", minLength: 1, maxLength: 1000, description: "Trimmed; 1–1000 characters (AC-REQ-034-01/-06)." })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: "employeeReason must not be empty" })
  @MaxLength(1000)
  employeeReason!: string;
}

export class ListAttendanceExcusesQuery {
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

export class AttendanceExcuseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  attendanceDayId!: string;

  @ApiProperty({ example: "2026-11-02" })
  workDate!: string;

  @ApiProperty({ example: "The bus broke down on the ring road." })
  employeeReason!: string;

  @ApiProperty({ example: "PENDING", description: "PENDING until an Admin decides (Admin review is not built yet, GAP-030)." })
  status!: string;

  @ApiProperty({ nullable: true, description: "The Admin's reason; null while PENDING." })
  decisionReason!: string | null;

  @ApiProperty({ nullable: true, description: "When the Admin decided; null while PENDING." })
  decidedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

class PaginationDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class AttendanceExcuseListDto {
  @ApiProperty({ type: [AttendanceExcuseDto] })
  items!: AttendanceExcuseDto[];

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}
