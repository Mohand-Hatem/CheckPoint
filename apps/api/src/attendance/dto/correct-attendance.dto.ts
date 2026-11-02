import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsNotEmpty, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

export const CORRECTION_ACTIONS = ['SET_CHECK_IN', 'SET_CHECK_OUT', 'EXEMPT'] as const;

export class CorrectAttendanceDto {
  @IsUUID()
  employeeId!: string;

  // Company-local date, YYYY-MM-DD
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'workDate must use YYYY-MM-DD format.' })
  workDate!: string;

  @IsIn(CORRECTION_ACTIONS)
  action!: (typeof CORRECTION_ACTIONS)[number];

  // ISO instant with offset, e.g. 2026-11-02T08:30:00+02:00; not used by EXEMPT
  @ValidateIf((dto: CorrectAttendanceDto) => dto.action !== 'EXEMPT')
  @IsISO8601({ strict: true })
  at?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}
