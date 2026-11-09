import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { CreateHolidayDto, HolidayResponseDto, ListHolidaysQuery, WeeklyOffDaysDto } from './calendar.dto';
import { CalendarService } from './calendar.service';

@ApiTags('Admin · Calendar')
@Controller('admin')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('holidays')
  @RequirePermission('settings.read')
  @ApiProtected()
  @ApiNeedsPermission('settings.read')
  @ApiOperation({ summary: "List the company's holidays (optionally one year), by date" })
  @ApiOkResponse({ type: HolidayResponseDto, isArray: true })
  listHolidays(@Query() query: ListHolidaysQuery, @CurrentUser() admin: AuthenticatedUser) {
    return this.calendar.listHolidays(admin.companyId, query.year);
  }

  @Post('holidays')
  @RequirePermission('settings.write')
  @ApiProtected()
  @ApiNeedsPermission('settings.write')
  @ApiOperation({
    summary: 'Add a holiday (FR-CAL-1)',
    description: 'No attendance is expected on a holiday. One holiday per date per company; the change is audited.',
  })
  @ApiCreatedResponse({ type: HolidayResponseDto })
  @ApiConflictResponse({ description: 'The company already has a holiday on that date.' })
  @ApiValidationError()
  createHoliday(@Body() dto: CreateHolidayDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.calendar.createHoliday(admin.companyId, admin.userId, dto.date, dto.name);
  }

  @Delete('holidays/:id')
  @RequirePermission('settings.write')
  @ApiProtected()
  @ApiNeedsPermission('settings.write')
  @ApiOperation({ summary: 'Remove a holiday (audited)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: HolidayResponseDto })
  @ApiNotFoundResponse({ description: 'Holiday not found in this company.' })
  deleteHoliday(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.calendar.deleteHoliday(admin.companyId, admin.userId, id);
  }

  @Get('settings/weekly-off-days')
  @RequirePermission('settings.read')
  @ApiProtected()
  @ApiNeedsPermission('settings.read')
  @ApiOperation({ summary: 'Weekly off days of the company' })
  @ApiOkResponse({ type: WeeklyOffDaysDto })
  async getWeeklyOffDays(@CurrentUser() admin: AuthenticatedUser) {
    return { days: await this.calendar.getWeeklyOffDays(admin.companyId) };
  }

  @Put('settings/weekly-off-days')
  @RequirePermission('settings.write')
  @ApiProtected()
  @ApiNeedsPermission('settings.write')
  @ApiOperation({
    summary: 'Replace the weekly off days (FR-CAL-1)',
    description: 'Duplicates are ignored and the days are stored in week order. All seven days off is refused (400). Audited.',
  })
  @ApiOkResponse({ type: WeeklyOffDaysDto })
  @ApiValidationError()
  async setWeeklyOffDays(@Body() dto: WeeklyOffDaysDto, @CurrentUser() admin: AuthenticatedUser) {
    return { days: await this.calendar.setWeeklyOffDays(admin.companyId, admin.userId, dto.days) };
  }
}
