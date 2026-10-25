import { ApiProperty } from '@nestjs/swagger';

export class LoginUserDto {
  @ApiProperty({ example: '7c9e6679-7425-40de-944b-e07fc1f90ae7', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'admin@checkpoint.local' })
  email!: string;

  @ApiProperty({ example: 'System Administrator', nullable: true, description: 'From the employee record; null if the account has none' })
  fullName!: string | null;

  @ApiProperty({ example: 'ADMIN', enum: ['ADMIN', 'EMPLOYEE'] })
  role!: string;

  @ApiProperty({ example: false, description: 'True for a first-time or reset password (not enforced yet)' })
  mustChangePassword!: boolean;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'JWT, valid 15 minutes. Send it as `Authorization: Bearer <accessToken>`.', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ description: 'Opaque single-use token, valid 30 days. Exchange it at POST /auth/refresh.', example: '3f9a1c0e5b7d4a62...64 hex characters' })
  refreshToken!: string;

  @ApiProperty({ type: LoginUserDto })
  user!: LoginUserDto;
}

export class RefreshResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ description: 'The NEW refresh token. The one you sent is now spent; keep only this one.', example: 'b21d84...64 hex characters' })
  refreshToken!: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Logged out successfully' })
  message!: string;
}

export class SessionDto {
  @ApiProperty({ format: 'uuid', example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
  userId!: string;

  @ApiProperty({ format: 'uuid', example: '0b8f9c2e-1d4a-4c3b-9a7e-5f6d8e1a2b3c', description: 'The caller\'s company. Taken from the token, never from the request.' })
  companyId!: string;

  @ApiProperty({ example: 'admin@checkpoint.local' })
  email!: string;

  @ApiProperty({ example: 'ADMIN' })
  role!: string;

  @ApiProperty({ type: [String], example: ['users.read', 'users.write'] })
  permissions!: string[];

  @ApiProperty({ example: false, description: 'True until the user changes the one-time password; every route except PATCH /me/password, GET /auth/me and logout answers 403 meanwhile' })
  mustChangePassword!: boolean;
}

export class PermissionCheckResponseDto {
  @ApiProperty({ example: 'Access granted: you have users.read permission' })
  message!: string;

  @ApiProperty({ type: SessionDto })
  user!: SessionDto;
}
