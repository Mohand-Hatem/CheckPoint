import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import {
  ApiNeedsPermission,
  ApiProtected,
  ApiValidationError,
} from "../common/api-docs";
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  AuthenticatedUser,
  CurrentUser,
} from "../auth/decorators/current-user.decorator";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { PointsModule } from "../points/points.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AttendanceService } from "./attendance.service";
import { AttendanceValidationService } from "./attendance-validation.service";
import { AttendanceDayService } from "./attendance-day.service";
import { CorrectAttendanceDto } from "./dto/correct-attendance.dto";
import { ListAttendanceQuery } from "./dto/list-attendance.query";
import { MyAttendanceQuery, MyAttendanceResponseDto } from "./dto/my-attendance.dto";
import { AbsenceSweepService } from "./absence-sweep.service";
import { CalendarModule } from "../calendar/calendar.module";
import { EmployeesModule } from "../employees/employees.module";
import {
  AttendanceExcuseDto,
  AttendanceExcuseListDto,
  CreateAttendanceExcuseDto,
  ListAttendanceExcusesQuery,
} from "./dto/attendance-excuse.dto";
import { EmployeeAttendanceExcuseService } from "./employee-attendance-excuse.service";

@ApiTags("Admin · Attendance")
@Controller("admin/attendance")
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequirePermission("attendance.read")
  @ApiProtected()
  @ApiNeedsPermission("attendance.read")
  @ApiOperation({ summary: "List attendance days of my company" })
  @ApiOkResponse({ description: "Success" })
  list(
    @Query() query: ListAttendanceQuery,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.attendance.list(admin.companyId, query);
  }

  @Get(":id")
  @RequirePermission("attendance.read")
  @ApiProtected()
  @ApiNeedsPermission("attendance.read")
  @ApiOperation({
    summary: "One day with its point entries and correction history",
  })
  @ApiOkResponse({ description: "Success" })
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.attendance.findOne(admin.companyId, id);
  }

  @Post("corrections")
  @RequirePermission("attendance.write")
  @ApiProtected()
  @ApiNeedsPermission("attendance.write")
  @ApiOperation({
    summary: "Correct a day: set check-in, set check-out or exempt",
    description:
      "Creates the day from the employee's shift if needed, reverses the day's current points with compensating entries, recomputes the classification and overtime Greens, and audits before/after with the mandatory reason. A concurrent correction of the same day answers 409.",
  })
  @ApiCreatedResponse({ description: "Success" })
  @ApiValidationError()
  correct(
    @Body() dto: CorrectAttendanceDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.attendance.correct(admin.companyId, admin.userId, dto);
  }
}

@ApiTags("Me")
@Controller("me")
export class MyAttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly excuses: EmployeeAttendanceExcuseService,
  ) {}

  @Post("attendance/:attendanceDayId/excuse")
  @ApiProtected()
  @ApiOperation({
    summary: "Explain one of my attendance days (REQ-034)",
    description:
      "Submit one written excuse for your own recorded day (any result, ABSENT included). It starts PENDING and changes no attendance or points. Someone else's day, another company's day or a missing day answers 404; a second excuse for the same day answers 409 EXCUSE_EXISTS.",
  })
  @ApiCreatedResponse({ type: AttendanceExcuseDto })
  @ApiNotFoundResponse({ description: "Not my attendance day (or no employee profile)." })
  @ApiConflictResponse({ description: "EXCUSE_EXISTS: the day already has an excuse; it cannot be resubmitted." })
  @ApiValidationError()
  submitExcuse(
    @Param("attendanceDayId", ParseUUIDPipe) attendanceDayId: string,
    @Body() dto: CreateAttendanceExcuseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.excuses.submit(user.companyId, user.userId, attendanceDayId, dto.employeeReason);
  }

  @Get("attendance-excuses")
  @ApiProtected()
  @ApiOperation({
    summary: "My attendance excuses (REQ-034)",
    description: "Only my own excuses in my company, newest first, each with its status and decision (empty while PENDING). Paged.",
  })
  @ApiOkResponse({ type: AttendanceExcuseListDto })
  @ApiValidationError()
  listExcuses(@Query() query: ListAttendanceExcusesQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.excuses.listMine(user.companyId, user.userId, query);
  }

  @Get("attendance-excuses/:id")
  @ApiProtected()
  @ApiOperation({
    summary: "One of my attendance excuses (REQ-034)",
    description: "Status and decision of one of my own excuses. Another employee's or company's excuse answers 404.",
  })
  @ApiOkResponse({ type: AttendanceExcuseDto })
  @ApiNotFoundResponse({ description: "Not my excuse." })
  @ApiValidationError()
  getExcuse(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.excuses.getMine(user.companyId, user.userId, id);
  }

  @Get("attendance")
  @ApiProtected()
  @ApiOperation({
    summary: "My attendance history for one month (FR-ATT-7)",
    description:
      "Only the signed-in employee's own days, oldest first: check-in and check-out times, the result and the day's point colour. Defaults to the current company month.",
  })
  @ApiOkResponse({ type: MyAttendanceResponseDto })
  @ApiValidationError()
  list(@Query() query: MyAttendanceQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.listMine(user.companyId, user.userId, query.month);
  }
}

@Module({
  imports: [PrismaModule, PointsModule, EmployeesModule, CalendarModule],
  controllers: [AttendanceController, MyAttendanceController],
  providers: [
    AbsenceSweepService,
    EmployeeAttendanceExcuseService,
    AttendanceService,
    AttendanceValidationService,
    AttendanceDayService,
  ],
  exports: [AttendanceValidationService, AttendanceDayService, AbsenceSweepService],
})
export class AttendanceModule {}
