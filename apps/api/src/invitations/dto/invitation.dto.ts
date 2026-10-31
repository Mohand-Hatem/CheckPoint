import { ApiProperty } from '@nestjs/swagger';
import { CompanyInvitationStatus } from '@prisma/client';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateInvitationDto {
  @ApiProperty({ example: 'newhire@acme.test', description: 'Email of the person being invited. Must not have an account yet.' })
  @IsEmail({}, { message: 'Must be a valid email' })
  email!: string;

  @ApiProperty({ example: 'New Hire' })
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({ example: 'EMP-050', description: 'Employee number to assign. Unique within the company.' })
  @IsString()
  @IsNotEmpty({ message: 'Employee code is required' })
  employeeCode!: string;
}

export class AcceptInvitationDto {
  @ApiProperty({ example: '9f2c4e...64 hex characters', description: 'The one-time token the Admin shared with the invitee' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'Password123!', minLength: 6, description: 'The password the invitee chooses' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;
}

export class InvitationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'newhire@acme.test' })
  email!: string;

  @ApiProperty({ example: 'New Hire' })
  fullName!: string;

  @ApiProperty({ example: 'EMP-050' })
  employeeNumber!: string;

  @ApiProperty({ enum: CompanyInvitationStatus, enumName: 'InvitationStatus', example: 'PENDING' })
  status!: CompanyInvitationStatus;

  @ApiProperty({ example: '2026-11-01T12:00:00.000Z', description: 'Seven days after creation' })
  expiresAt!: string;

  @ApiProperty({ nullable: true, example: null })
  acceptedAt!: string | null;

  @ApiProperty({ nullable: true, example: null })
  revokedAt!: string | null;

  @ApiProperty({ example: '2026-10-25T12:00:00.000Z' })
  createdAt!: string;
}

export class CreatedInvitationResponseDto extends InvitationResponseDto {
  @ApiProperty({
    example: '9f2c4e...64 hex characters',
    description: 'The one-time token. Returned ONLY here and never stored: share it with the invitee now.',
  })
  token!: string;
}

export class AcceptInvitationResponseDto {
  @ApiProperty({ example: 'newhire@acme.test' })
  email!: string;

  @ApiProperty({ example: 'Account created. You can now sign in.' })
  message!: string;
}
