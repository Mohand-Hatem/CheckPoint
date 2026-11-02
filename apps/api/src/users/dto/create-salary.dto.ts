import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
} from 'class-validator';

export class CreateSalaryDto {
  @ApiProperty({ example: 13500, description: 'Monthly salary in EGP' })
  @IsNumber()
  @IsPositive({ message: 'Salary amount must be greater than 0' })
  @IsNotEmpty()
  amount!: number;

  @ApiPropertyOptional({ example: 'EGP', enum: ['EGP'], description: 'EGP is the only supported currency' })
  @IsIn(['EGP'], { message: 'EGP is the only supported currency' })
  @IsOptional()
  currency?: string;

  @ApiProperty({ example: '2026-11-01', description: 'Must be the 1st of a month. Past months are never rewritten; use a new date.' })
  @IsDateString({}, { message: 'effectiveFrom must be an ISO date string (YYYY-MM-DD)' })
  @IsNotEmpty()
  effectiveFrom!: string;
}
