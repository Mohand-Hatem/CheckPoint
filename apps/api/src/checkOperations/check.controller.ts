import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { CheckOutResponseDto, PositionDto } from './dto/check.dto';

@ApiTags('Employee · Attendance')
@Controller('employee/attendance')
export class CheckController {
  constructor(private readonly checks: CheckService) {}

  @Post('check-in')
  @RequirePermission('attendance.checkin')
  @ApiProtected()
  @ApiNeedsPermission('attendance.checkin')
  @ApiOperation({
    summary: 'Check in for today',
    description:
      "Checks the logged-in employee in at their current GPS position. Rejected before the shift opens (CHECKIN_NOT_OPEN) unless an active EARLY_WORK offer covers this moment; then the day is GREEN plus one GREEN per full hour before the shift start. GPS accuracy above the company limit answers 422 GPS_ACCURACY_TOO_LOW. A second check-in the same day answers 409.",
  })
  @ApiCreatedResponse({ description: 'The attendance day and the point entries awarded.' })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto, description: 'GPS_ACCURACY_TOO_LOW.' })
  @ApiValidationError()
  checkIn(@Body() dto: PositionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.checks.checkInAsUser(user.companyId, user.userId, dto);
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
