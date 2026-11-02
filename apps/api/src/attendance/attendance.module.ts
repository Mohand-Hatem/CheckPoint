import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { AttendanceService } from './attendance.service';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { ListAttendanceQuery } from './dto/list-attendance.query';

@Controller('admin/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequirePermission('attendance.read')
  list(@Query() query: ListAttendanceQuery, @CurrentUser() admin: AuthenticatedUser) {
    return this.attendance.list(admin.companyId, query);
  }

  @Get(':id')
  @RequirePermission('attendance.read')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.attendance.findOne(admin.companyId, id);
  }

  @Post('corrections')
  @RequirePermission('attendance.write')
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
