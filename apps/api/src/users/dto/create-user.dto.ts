import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'sara@acme.test', description: 'Login email. Unique across the whole system.' })
  @IsEmail({}, { message: 'Must be a valid email' })
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({ example: 'Password123!', minLength: 6, description: 'Initial password (stored as an argon2id hash)' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;

  @ApiProperty({ example: 'EMP-001', description: 'Employee number. Unique within the company.' })
  @IsString()
  @IsNotEmpty({ message: 'Employee code is required' })
  employeeCode!: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: 'EMPLOYEE', enum: ['ADMIN', 'EMPLOYEE'], description: 'Role code (case-insensitive)' })
  @IsString()
  @IsNotEmpty({ message: 'Role code is required (e.g. ADMIN or EMPLOYEE)' })
  roleCode!: string;

  @ApiPropertyOptional({ example: 12000, description: 'Monthly salary in EGP, effective from the 1st of the current month' })
  @IsNumber()
  @IsPositive({ message: 'Initial salary must be greater than 0' })
  @IsOptional()
  initialSalary?: number;

  @ApiPropertyOptional({ example: 'EGP', enum: ['EGP'], description: 'EGP is the only supported currency' })
  @IsIn(['EGP'], { message: 'EGP is the only supported currency' })
  @IsOptional()
  currency?: string;
}
