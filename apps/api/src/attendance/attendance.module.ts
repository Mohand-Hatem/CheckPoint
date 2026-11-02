import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { AttendanceService } from './attendance.service';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { ListAttendanceQuery } from './dto/list-attendance.query';

@ApiTags('Admin · Attendance')
@Controller('admin/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequirePermission('attendance.read')
  @ApiProtected()
  @ApiNeedsPermission('attendance.read')
  @ApiOperation({ summary: 'List attendance days of my company' })
  @ApiOkResponse({ description: 'Success' })
  list(@Query() query: ListAttendanceQuery, @CurrentUser() admin: AuthenticatedUser) {
    return this.attendance.list(admin.companyId, query);
  }

  @Get(':id')
  @RequirePermission('attendance.read')
  @ApiProtected()
  @ApiNeedsPermission('attendance.read')
  @ApiOperation({ summary: 'One day with its point entries and correction history' })
  @ApiOkResponse({ description: 'Success' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.attendance.findOne(admin.companyId, id);
  }

  @Post('corrections')
  @RequirePermission('attendance.write')
  @ApiProtected()
  @ApiNeedsPermission('attendance.write')
  @ApiOperation({ summary: 'Correct a day: set check-in, set check-out or exempt', description: "Creates the day from the employee's shift if needed, reverses the day's current points with compensating entries, recomputes the classification and overtime Greens, and audits before/after with the mandatory reason. A concurrent correction of the same day answers 409." })
  @ApiCreatedResponse({ description: 'Success' })
  @ApiValidationError()
  correct(@Body() dto: CorrectAttendanceDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.attendance.correct(admin.companyId, admin.userId, dto);
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
