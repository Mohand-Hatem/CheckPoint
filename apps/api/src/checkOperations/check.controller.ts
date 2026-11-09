import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { CheckService } from './check.service';
import { CheckInDto } from './dto/check.dto';

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
      "Checks the logged-in employee in at their current GPS position. Rejected before the shift opens (CHECKIN_NOT_OPEN) unless an active EARLY_WORK offer covers this moment; then the day is GREEN plus one GREEN per full hour before the shift start. A second check-in the same day answers 409.",
  })
  @ApiCreatedResponse({ description: 'The attendance day and the point entries awarded.' })
  @ApiValidationError()
  checkIn(@Body() dto: CheckInDto, @CurrentUser() user: AuthenticatedUser) {
    return this.checks.checkInAsUser(user.companyId, user.userId, dto);
  }
}
