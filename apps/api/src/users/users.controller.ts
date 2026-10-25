import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { AllowPasswordChange } from '../auth/decorators/allow-password-change.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ChangePasswordDto, ChangePasswordResponseDto } from '../auth/dto/change-password.dto';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import {
  CreatedSalaryResponseDto,
  MyProfileResponseDto,
  UserListResponseDto,
  UserResponseDto,
} from './dto/user-responses.dto';
import { UsersService } from './users.service';

const notFoundInCompany = {
  type: ErrorResponseDto,
  description:
    'No such user **in your company**. A user of another company gets the same answer, so nothing is revealed about it.',
  example: { statusCode: 404, message: "User with ID '00000000-0000-4000-8000-000000000000' not found", error: 'Not Found' },
};

@ApiTags('Admin · Users')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermission('users.write')
  @ApiProtected()
  @ApiNeedsPermission('users.write')
  @ApiOperation({
    summary: 'Create a user and employee in my company',
    description:
      '**Scenario:** an Admin adds an employee directly (the alternative is an invitation). The user, role link, employee record and optional first salary are created in one transaction, ' +
      'always inside the Admin\'s own company. `mustChangePassword` starts as `true`.\n\n' +
      '**Rules:** the email must be new in the whole system; the employee code must be new in this company; the company needs an active shift (created at provisioning).',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiValidationError()
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Email or employee code already in use.',
    example: { statusCode: 409, message: 'Email is already registered', error: 'Conflict' },
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Unknown role code.', example: { statusCode: 404, message: "Role 'MANAGER' not found", error: 'Not Found' } })
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.usersService.createUser(admin.companyId, dto, admin.userId);
  }

  @Get()
  @RequirePermission('users.read')
  @ApiProtected()
  @ApiNeedsPermission('users.read')
  @ApiOperation({
    summary: 'List users of my company',
    description: '**Scenario:** an Admin browses and searches employees. Only users of the Admin\'s company are ever returned. Paginated, newest first.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Max 100' })
  @ApiQuery({ name: 'search', required: false, example: 'sara', description: 'Matches email, full name or employee code' })
  @ApiQuery({ name: 'role', required: false, example: 'EMPLOYEE', enum: ['ADMIN', 'EMPLOYEE'] })
  @ApiQuery({ name: 'active', required: false, example: 'true', enum: ['true', 'false'] })
  @ApiOkResponse({ type: UserListResponseDto })
  async getUsers(
    @CurrentUser() admin: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('active') active?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const activeBool =
      active === 'true' ? true : active === 'false' ? false : undefined;

    return this.usersService.getUsers(
      admin.companyId,
      pageNum,
      limitNum,
      search,
      role,
      activeBool,
    );
  }

  @Get(':id')
  @RequirePermission('users.read')
  @ApiProtected()
  @ApiNeedsPermission('users.read')
  @ApiOperation({
    summary: 'Get one user with salary history',
    description: '**Scenario:** an Admin opens an employee. Another company\'s user id returns 404, exactly like an id that does not exist.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User id' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse(notFoundInCompany)
  async getUserById(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.getUserById(admin.companyId, id);
  }

  @Patch(':id/status')
  @RequirePermission('users.write')
  @ApiProtected()
  @ApiNeedsPermission('users.write')
  @ApiOperation({
    summary: 'Activate or deactivate a user',
    description:
      '**Scenario:** an employee leaves. `{"active": false}` revokes all their refresh tokens in the same transaction and stops new absences from being recorded, ' +
      'so they cannot refresh or sign in again. Their current access token still works until it expires (up to 15 minutes). `{"active": true}` reactivates.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User id' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiValidationError()
  @ApiNotFoundResponse(notFoundInCompany)
  async updateUserStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateUserStatus(admin.companyId, id, dto.active, admin.userId);
  }

  @Post(':id/salaries')
  @RequirePermission('users.write')
  @ApiProtected()
  @ApiNeedsPermission('users.write')
  @ApiOperation({
    summary: 'Add a salary version',
    description:
      '**Scenario:** a raise. Salaries are versioned, never edited: the new row applies from `effectiveFrom`, which must be the 1st of a month. ' +
      'Sending the same date again replaces that one version. Amounts are EGP.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User id' })
  @ApiCreatedResponse({ type: CreatedSalaryResponseDto })
  @ApiValidationError()
  @ApiNotFoundResponse(notFoundInCompany)
  async createSalary(
    @Param('id') id: string,
    @Body() dto: CreateSalaryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.usersService.createSalary(admin.companyId, id, dto, admin.userId);
  }
}

@ApiTags('Me')
@Controller('me')
export class MeController {
  constructor(private readonly usersService: UsersService) {}

  // No :id parameter and no query filter: the owner is always the signed-in user from the session.
  @Get('profile')
  @ApiProtected()
  @ApiOperation({
    summary: 'My own profile',
    description:
      '**Scenario:** an EMPLOYEE (or ADMIN) reads their own profile. The record is chosen only by the access token, so there is no way to ask for someone else\'s. ' +
      'Any extra query parameter is ignored.',
  })
  @ApiOkResponse({ type: MyProfileResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The account no longer exists.' })
  async getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMyProfile(user.companyId, user.userId);
  }

  @Patch('password')
  @AllowPasswordChange()
  @ApiProtected()
  @ApiOperation({
    summary: 'Change my password',
    description:
      '**Scenario:** the first Admin of a company (or an employee an Admin created) signs in with a one-time password. Until it is changed, **every other route answers 403** ' +
      'with `code: PASSWORD_CHANGE_REQUIRED` (only `GET /auth/me`, logout and this route work). Anyone may also change their password voluntarily.\n\n' +
      '**Effect:** the new password applies at once, `mustChangePassword` becomes false, and **all sessions end**, so sign in again with the new password. ' +
      'Wrong current passwords are rate-limited (5 per minute).',
  })
  @ApiOkResponse({ type: ChangePasswordResponseDto })
  @ApiValidationError()
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'The current password is wrong, or the new one equals the current one.',
    example: { statusCode: 400, message: 'Current password is incorrect', error: 'Bad Request' },
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Too many wrong current passwords.' })
  async changeMyPassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.usersService.changeMyPassword(user, dto);
  }
}
