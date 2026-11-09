import {
  ApiCreatedResponse,
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
import { PrismaModule } from "../prisma/prisma.module";
import { AttendanceService } from "./attendance.service";
import { AttendanceValidationService } from "./attendance-validation.service";
import { AttendanceDayService } from "./attendance-day.service";
import { CorrectAttendanceDto } from "./dto/correct-attendance.dto";
import { ListAttendanceQuery } from "./dto/list-attendance.query";
import { MyAttendanceQuery, MyAttendanceResponseDto } from "./dto/my-attendance.dto";

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
  constructor(private readonly attendance: AttendanceService) {}

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
  imports: [PrismaModule],
  controllers: [AttendanceController, MyAttendanceController],
  providers: [
    AttendanceService,
    AttendanceValidationService,
    AttendanceDayService,
  ],
  exports: [AttendanceValidationService, AttendanceDayService],
})
export class AttendanceModule {}
