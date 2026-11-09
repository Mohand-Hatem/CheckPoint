import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CheckService } from './check.service';
import { CheckInStartedResponseDto, CheckOutResponseDto, ConfirmCheckInDto, PositionDto } from './dto/check.dto';

@ApiTags('Employee · Attendance')
@Controller('employee/attendance')
export class CheckController {
  constructor(private readonly checks: CheckService) {}

  @Post('check-in')
  @RequirePermission('attendance.checkin')
  @ApiProtected()
  @ApiNeedsPermission('attendance.checkin')
  @ApiOperation({
    summary: 'Check in, step 1: GPS (FR-ATT-1)',
    description:
      "Validates the logged-in employee's GPS position and starts a check-in that must be confirmed by scanning the kiosk QR code within 15 minutes (step 2). **Nothing is recorded or awarded yet.** Calling again while a check-in is pending returns the same one. " +
      'Rejected before the shift opens (CHECKIN_NOT_OPEN) unless an active EARLY_WORK offer covers this moment. GPS accuracy above the company limit answers 422 GPS_ACCURACY_TOO_LOW; already checked in today answers 409 ALREADY_CHECKED_IN.',
  })
  @ApiCreatedResponse({ type: CheckInStartedResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto, description: 'GPS_ACCURACY_TOO_LOW.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'ALREADY_CHECKED_IN.' })
  @ApiValidationError()
  checkIn(@Body() dto: PositionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.checks.checkInAsUser(user.companyId, user.userId, dto);
  }

  @Post('check-in/confirm')
  @RequirePermission('attendance.checkin')
  @ApiProtected()
  @ApiNeedsPermission('attendance.checkin')
  @ApiOperation({
    summary: 'Check in, step 2: scan the kiosk QR (FR-ATT-2)',
    description:
      'Confirms a pending check-in with the QR token shown on the kiosk of the same location. The day is recorded at the step-1 time and its points are awarded. ' +
      'Expired (over 15 minutes) answers 410 VERIFICATION_EXPIRED; a bad or old token 422 QR_TOKEN_INVALID; a token of another location 422 QR_LOCATION_MISMATCH; already confirmed 409 ALREADY_CHECKED_IN.',
  })
  @ApiCreatedResponse({ description: 'The attendance day and the point entries awarded.' })
  @ApiGoneResponse({ type: ErrorResponseDto, description: 'VERIFICATION_EXPIRED.' })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto, description: 'QR_TOKEN_INVALID or QR_LOCATION_MISMATCH.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'ALREADY_CHECKED_IN.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'No such pending check-in for this employee.' })
  @ApiValidationError()
  confirm(@Body() dto: ConfirmCheckInDto, @CurrentUser() user: AuthenticatedUser) {
    return this.checks.confirmCheckInAsUser(user.companyId, user.userId, dto.verificationId, dto.qrToken);
  }

  @Post('check-out')
  @HttpCode(200)
  @RequirePermission('attendance.checkin')
  @ApiProtected()
  @ApiNeedsPermission('attendance.checkin')
  @ApiOperation({
    summary: 'Check out for today (REQ-014, FR-ATT-5)',
    description:
      'Records the checkout at server time on today\'s attendance day and awards one OVERTIME GREEN per full hour after the scheduled shift end. The client cannot send a time or overtime amount. Requires GPS accuracy within the company limit and a position inside an assigned location.',
  })
  @ApiOkResponse({ type: CheckOutResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'INVALID_STATE (no check-in today) or GPS_ACCURACY_TOO_LOW.',
  })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'ALREADY_CHECKED_OUT.' })
  @ApiValidationError()
  checkOut(@Body() dto: PositionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.checks.checkOutAsUser(user.companyId, user.userId, dto);
  }
}
