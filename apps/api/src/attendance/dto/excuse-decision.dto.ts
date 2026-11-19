import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";

export const EXCUSE_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ExcuseDecision = (typeof EXCUSE_DECISIONS)[number];

export class DecideAttendanceExcuseDto {
  @ApiProperty({ enum: EXCUSE_DECISIONS, example: "APPROVED" })
  @IsIn(EXCUSE_DECISIONS)
  decision!: ExcuseDecision;

  @ApiProperty({ example: "Reviewed the employee explanation.", minLength: 1, maxLength: 1000, description: "Trimmed; 1–1000 characters (AC-REQ-035-02)." })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: "decisionReason must not be empty" })
  @MaxLength(1000)
  decisionReason!: string;
}

export class AdminAttendanceExcuseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  attendanceDayId!: string;

  @ApiProperty({ example: "I was delayed by a transit disruption." })
  employeeReason!: string;

  @ApiProperty({ enum: ["PENDING", ...EXCUSE_DECISIONS], example: "APPROVED" })
  status!: string;

  @ApiProperty({ nullable: true, example: "Reviewed the employee explanation." })
  decisionReason!: string | null;

  @ApiProperty({ format: "uuid" })
  submittedByUserId!: string;

  @ApiProperty({ format: "uuid", nullable: true })
  decidedByUserId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true })
  decidedAt!: Date | null;
}
