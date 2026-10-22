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
  @IsEmail({}, { message: 'Must be a valid email' })
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Employee code is required' })
  employeeCode!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsNotEmpty({ message: 'Role code is required (e.g. ADMIN or EMPLOYEE)' })
  roleCode!: string;

  @IsNumber()
  @IsPositive({ message: 'Initial salary must be greater than 0' })
  @IsOptional()
  initialSalary?: number;

  @IsIn(['EGP'], { message: 'EGP is the only supported currency' })
  @IsOptional()
  currency?: string;
}
