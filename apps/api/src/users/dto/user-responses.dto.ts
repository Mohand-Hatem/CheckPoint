import { ApiProperty } from '@nestjs/swagger';

export class RoleDto {
  @ApiProperty({ example: 'EMPLOYEE', enum: ['ADMIN', 'EMPLOYEE'] })
  code!: string;

  @ApiProperty({ example: 'Employee' })
  name!: string;
}

export class SalaryCreatorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'admin@checkpoint.local' })
  email!: string;
}

export class SalaryVersionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '12000', description: 'Decimal amount, serialized as a string to avoid rounding' })
  amount!: string;

  @ApiProperty({ example: 'EGP' })
  currency!: string;

  @ApiProperty({ example: '2026-10-01T00:00:00.000Z' })
  effectiveFrom!: string;

  @ApiProperty({ example: '2026-10-25T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ type: SalaryCreatorDto, nullable: true })
  creator!: SalaryCreatorDto | null;
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid', example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
  id!: string;

  @ApiProperty({ example: 'sara@acme.test' })
  email!: string;

  @ApiProperty({ example: 'Sara Ahmed', nullable: true })
  fullName!: string | null;

  @ApiProperty({ example: 'EMP-001', nullable: true })
  employeeCode!: string | null;

  @ApiProperty({ example: '+201001234567', nullable: true })
  phone!: string | null;

  @ApiProperty({ example: true, description: 'false after deactivation' })
  active!: boolean;

  @ApiProperty({ example: true })
  mustChangePassword!: boolean;

  @ApiProperty({ example: '2026-10-25T00:00:00.000Z', nullable: true, description: 'First date an absence (BLACK) may be recorded' })
  activeFrom!: string | null;

  @ApiProperty({ example: null, nullable: true, description: 'Set when the user is deactivated' })
  disabledAt!: string | null;

  @ApiProperty({ example: '2026-10-25T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-10-25T12:00:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ type: RoleDto, nullable: true })
  role!: RoleDto | null;

  @ApiProperty({
    type: SalaryVersionDto,
    nullable: true,
    description: 'The salary in force today (Cairo date): the latest version that has already started. null if none has started.',
  })
  currentSalary!: SalaryVersionDto | null;

  @ApiProperty({
    type: SalaryVersionDto,
    nullable: true,
    description: 'The next salary, dated in the future, or null. It never counts as current before its date.',
  })
  upcomingSalary!: SalaryVersionDto | null;
}

export class UserDetailResponseDto extends UserResponseDto {
  @ApiProperty({ type: [SalaryVersionDto], description: 'Full salary history, newest first. Only on GET /admin/users/{id}.' })
  salaries!: SalaryVersionDto[];
}

export class UserListResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  data!: UserResponseDto[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}

export class CreatedSalaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '13500' })
  amount!: string;

  @ApiProperty({ example: 'EGP' })
  currency!: string;

  @ApiProperty({ example: '2026-11-01T00:00:00.000Z' })
  effectiveFrom!: string;

  @ApiProperty({ example: '2026-10-25T12:00:00.000Z' })
  createdAt!: string;
}

export class MyProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'sara@acme.test' })
  email!: string;

  @ApiProperty({ example: 'Sara Ahmed', nullable: true })
  fullName!: string | null;

  @ApiProperty({ example: 'EMP-001', nullable: true })
  employeeCode!: string | null;

  @ApiProperty({ example: '+201001234567', nullable: true })
  phone!: string | null;

  @ApiProperty({ example: 'EMPLOYEE', nullable: true })
  role!: string | null;

  @ApiProperty({ example: false })
  mustChangePassword!: boolean;

  @ApiProperty({ example: '2026-10-25T00:00:00.000Z', nullable: true })
  activeFrom!: string | null;
}
