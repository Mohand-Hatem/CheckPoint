import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class CreateSalaryDto {
  @IsNumber()
  @IsPositive({ message: 'Salary amount must be greater than 0' })
  @IsNotEmpty()
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsDateString({}, { message: 'effectiveFrom must be an ISO date string (YYYY-MM-DD)' })
  @IsNotEmpty()
  effectiveFrom!: string;
}
