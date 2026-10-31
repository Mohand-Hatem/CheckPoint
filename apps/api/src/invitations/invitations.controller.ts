import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { LoginThrottled } from '../auth/guards/login-throttle.guard';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import {
  AcceptInvitationDto,
  AcceptInvitationResponseDto,
  CreatedInvitationResponseDto,
  CreateInvitationDto,
  InvitationResponseDto,
} from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('admin/invitations')
  @RequirePermission('users.write')
  @ApiTags('Admin · Invitations')
  @ApiProtected()
  @ApiNeedsPermission('users.write')
  @ApiOperation({
    summary: 'Invite an employee into my company',
    description:
      '**Scenario:** an Admin invites a new hire. The response contains the one-time `token` **once**; only its hash is stored. ' +
      'Share the token with the invitee, who redeems it at `POST /auth/invitations/accept`. It is single-use and expires after 7 days.\n\n' +
      '**Rules:** the email must not have an account anywhere; the employee code must be free in this company; only one pending invitation per email or code.',
  })
  @ApiCreatedResponse({ type: CreatedInvitationResponseDto })
  @ApiValidationError()
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Email already has an account, employee code in use, or a pending invitation already exists.',
    example: { statusCode: 409, message: 'A pending invitation already exists for this email or employee code', error: 'Conflict' },
  })
  create(@CurrentUser() admin: AuthenticatedUser, @Body() dto: CreateInvitationDto) {
    return this.invitationsService.create(admin.companyId, admin.userId, dto);
  }

  @Get('admin/invitations')
  @RequirePermission('users.read')
  @ApiTags('Admin · Invitations')
  @ApiProtected()
  @ApiNeedsPermission('users.read')
  @ApiOperation({
    summary: 'List my company\'s invitations',
    description: '**Scenario:** an Admin checks who is still pending, accepted, revoked or expired. Never includes tokens. Only this company\'s invitations are returned.',
  })
  @ApiOkResponse({ type: [InvitationResponseDto] })
  list(@CurrentUser() admin: AuthenticatedUser) {
    return this.invitationsService.list(admin.companyId);
  }

  @Delete('admin/invitations/:id')
  @RequirePermission('users.write')
  @ApiTags('Admin · Invitations')
  @ApiProtected()
  @ApiNeedsPermission('users.write')
  @ApiOperation({
    summary: 'Revoke a pending invitation',
    description: '**Scenario:** the invitation was sent by mistake. Its token stops working immediately. Only a `PENDING` invitation can be revoked.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Invitation id' })
  @ApiOkResponse({ type: InvitationResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such invitation in your company (another company\'s invitation looks the same).',
    example: { statusCode: 404, message: "Invitation '00000000-0000-4000-8000-000000000000' not found", error: 'Not Found' },
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The invitation is no longer pending.',
    example: { statusCode: 409, message: 'Only a pending invitation can be revoked (this one is ACCEPTED)', error: 'Conflict' },
  })
  revoke(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string) {
    return this.invitationsService.revoke(admin.companyId, id, admin.userId);
  }

  // Public by necessity (the invitee has no account yet); the one-time token is the credential.
  @Public()
  @LoginThrottled()
  @Post('auth/invitations/accept')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Auth')
  @ApiOperation({
    summary: 'Redeem an invitation and create my account',
    description:
      'Public route (the one-time token is the credential).\n\n' +
      '**Scenario:** the invitee opens the link their Admin shared, chooses a password, and the account is created **in the inviter\'s company** with the EMPLOYEE role. ' +
      'No tokens are issued here: sign in afterwards with `POST /auth/login`.\n\n' +
      '**Rules:** an unknown, expired, revoked or already-used token all return the same 400, so nothing leaks. Rate-limited like login.',
  })
  @ApiOkResponse({ type: AcceptInvitationResponseDto })
  @ApiValidationError()
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invitation is invalid or has expired (unknown, expired, revoked or used).',
    example: { statusCode: 400, message: 'Invitation is invalid or has expired', error: 'Bad Request' },
  })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'An account with this email or employee code already exists.' })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Too many attempts from this IP.' })
  accept(@Body() dto: AcceptInvitationDto) {
    return this.invitationsService.accept(dto);
  }
}
