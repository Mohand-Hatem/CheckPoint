import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PointType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AttendanceDayService } from '../attendance/attendance-day.service';
import { AttendanceValidationService } from '../attendance/attendance-validation.service';
import {
  beforeTimeGreens,
  classifyCheckIn,
  computeWindows,
  ShiftTimes,
} from '../attendance/attendance-rules';
import { CompanyPolicyService } from '../company/company-policy.service';
import { EmployeesService } from '../employees/employees.service';
import { LocationService } from '../location/location.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkOffersService } from '../work-offers/work-offers.service';

type CheckInPoint = {
  pointType: PointType;
  quantity: number;
  reason: string;
  idempotencyKey: string;
};

@Injectable()
export class CheckService {
  constructor(
    private readonly attendanceValidation: AttendanceValidationService,
    private readonly attendanceDay: AttendanceDayService,
    private readonly companyPolicy: CompanyPolicyService,
    private readonly employees: EmployeesService,
    private readonly locations: LocationService,
    private readonly points: PointsService,
    private readonly workOffers: WorkOffersService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async checkIn(
    companyId: string,
    employeeId: string,
    employeeLocation: { latitude: number; longitude: number },
  ) {
    const checkInTime = new Date();
    const employee = await this.employees.findOne(companyId, employeeId);
    if (!employee.isActive || !employee.user?.id || !employee.user.isActive) {
      throw new ForbiddenException('An active employee login is required.');
    }
    const userId = employee.user.id;

    const timezone = await this.companyPolicy.getTimezone(
      companyId,
      checkInTime,
    );
    const workDate = await this.companyPolicy.getCompanyDate(
      companyId,
      checkInTime,
    );
    await this.attendanceValidation.assertCanCheckIn(
      companyId,
      employeeId,
      workDate,
    );

    const location = await this.locations.isInAllowedLocation(
      userId,
      companyId,
      'CHECKIN',
      employeeLocation,
    );

    const shift = employee.currentShift.versions.find(
      (version) =>
        version.effectiveFrom <= workDate &&
        (!version.effectiveTo || version.effectiveTo >= workDate),
    ) as ShiftTimes | undefined;
    if (!shift) {
      throw new BadRequestException(
        'Employee has no shift version effective on this work date.',
      );
    }

    const assignment = employee.shiftAssignments.find(
      (item) =>
        item.shiftId === employee.currentShift.id &&
        item.effectiveFrom <= workDate &&
        (!item.effectiveTo || item.effectiveTo >= workDate),
    );
    const windows = computeWindows(workDate, shift, timezone);
    const result = classifyCheckIn(checkInTime, windows);
    const point = await this.getPointForResult({
      result,
      companyId,
      employeeId,
      userId,
      checkInTime,
      workDate,
      scheduledStartAt: windows.scheduledStartAt,
    });

    return this.prisma.$transaction(async (tx) => {
      const attendance = await this.attendanceDay.recordAttendanceDay(
        {
          companyId,
          employeeId,
          workDate,
          timezone,
          shiftAssignmentId: assignment?.id ?? null,
          scheduledStartAt: windows.scheduledStartAt,
          earlyEndAt: windows.earlyEndAt,
          graceEndAt: windows.graceEndAt,
          redPeriodEndAt: windows.redPeriodEndAt,
          scheduledEndAt: windows.scheduledEndAt,
          checkInAt: checkInTime,
          checkInResult: result,
          classification: result === 'NOT_OPEN' ? null : result,
        },
        tx,
      );

      const pointEntry = point
        ? await this.points.addPointEntryForSource(
            {
              companyId,
              employeeId,
              pointType: point.pointType,
              quantity: point.quantity,
              sourceType: 'ATTENDANCE',
              sourceId: attendance.id,
              idempotencyKey: point.idempotencyKey,
              reason: point.reason,
              createdByUserId: userId,
              asOfDate: workDate,
            },
            tx,
          )
        : null;

      await this.audit.record(tx, {
        companyId,
        actorUserId: userId,
        actorType: 'EMPLOYEE',
        action: 'attendance.check_in',
        targetType: 'attendance_day',
        targetId: attendance.id,
        changes: {
          checkInAt: checkInTime.toISOString(),
          checkInResult: result,
          classification: result === 'NOT_OPEN' ? null : result,
          locationId: location.locationId,
          pointEntryId: pointEntry?.id ?? null,
        },
      });

      return { attendance, pointEntry };
    });
  }

  private async getPointForResult(input: {
    result: ReturnType<typeof classifyCheckIn>;
    companyId: string;
    employeeId: string;
    userId: string;
    checkInTime: Date;
    workDate: Date;
    scheduledStartAt: Date;
  }): Promise<CheckInPoint | null> {
    const dateKey = input.workDate.toISOString().slice(0, 10);
    if (input.result !== 'NOT_OPEN') {
      return {
        pointType: input.result,
        quantity: 1,
        reason: `Attendance check-in classified as ${input.result}.`,
        idempotencyKey: `ATT:${input.employeeId}:${dateKey}`,
      };
    }

    const offers = await this.workOffers.listForEmployee(
      input.companyId,
      input.userId,
    );
    if (offers.length === 0) return null;

    const offerStartTime = new Date(offers[0].startsAt);
    const rewardedStartTime =
      input.checkInTime.getTime() < offerStartTime.getTime()
        ? offerStartTime
        : input.checkInTime;
    const quantity = beforeTimeGreens(
      rewardedStartTime,
      input.scheduledStartAt,
    );
    if (quantity === 0) return null;

    return {
      pointType: PointType.GREEN,
      quantity,
      reason: 'Employee checked in early and was rewarded with points.',
      idempotencyKey: `ATT_EARLY:${input.employeeId}:${dateKey}`,
    };
  }
}
