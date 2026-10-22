import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
} from 'class-validator';

export class CreateSalaryDto {
  @IsNumber()
  @IsPositive({ message: 'Salary amount must be greater than 0' })
  @IsNotEmpty()
  amount!: number;

  @IsIn(['EGP'], { message: 'EGP is the only supported currency' })
  @IsOptional()
  currency?: string;

  @IsDateString({}, { message: 'effectiveFrom must be an ISO date string (YYYY-MM-DD)' })
  @IsNotEmpty()
  effectiveFrom!: string;
}
