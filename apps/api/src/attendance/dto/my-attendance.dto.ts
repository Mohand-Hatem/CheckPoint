import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, Matches } from "class-validator";

export class MyAttendanceQuery {
  @ApiPropertyOptional({ example: "2026-11", description: "Month (YYYY-MM); default: the current company month." })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "month must be YYYY-MM" })
  month?: string;
}

export class MyAttendanceDayDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "2026-11-02" })
  workDate!: string;

  @ApiProperty({ nullable: true, example: "2026-11-02T06:10:00.000Z" })
  checkInAt!: Date | null;

  @ApiProperty({ nullable: true, example: "2026-11-02T14:05:00.000Z" })
  checkOutAt!: Date | null;

  @ApiProperty({ example: "GREEN", description: "GREEN / WHITE / RED / BLACK, OFF_DAY_WORK, CORRECTED, EXEMPT or SCHEDULED." })
  checkInResult!: string;

  @ApiProperty({ nullable: true, enum: ["GREEN", "WHITE", "RED", "BLACK"] })
  classification!: string | null;

  @ApiProperty({ example: "2026-11-02T06:00:00.000Z" })
  scheduledStartAt!: Date;

  @ApiProperty({ example: "2026-11-02T14:00:00.000Z" })
  scheduledEndAt!: Date;

  @ApiProperty({ example: false, description: "Checked out before the shift end (shown for information, no penalty)." })
  leftEarly!: boolean;

  @ApiProperty({ example: 1, description: "Overtime GREENs awarded at checkout." })
  overtimeGreens!: number;
}

export class MyAttendanceResponseDto {
  @ApiProperty({ example: "2026-11" })
  month!: string;

  @ApiProperty({ type: [MyAttendanceDayDto] })
  days!: MyAttendanceDayDto[];
}
