import { IsDateString, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class AssignShiftDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString({ strict: true })
  effectiveTo?: string;
}
