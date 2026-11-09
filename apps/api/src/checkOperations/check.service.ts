import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PointType, WorkOfferStatus, WorkOfferType } from '@prisma/client';
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

  async checkInAsUser(
    companyId: string,
    userId: string,
    employeeLocation: { latitude: number; longitude: number },
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, userId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('No employee profile is linked to this account.');
    }
    return this.checkIn(companyId, employee.id, employeeLocation);
  }

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
    if (!employee.currentShift.isActive || !shift) {
      throw new BadRequestException(
        'Employee has no active shift effective on this work date.',
      );
    }

    const assignment = employee.shiftAssignments.find(
      (item) =>
        item.shiftId === employee.currentShift.id &&
        item.effectiveFrom <= workDate &&
        (!item.effectiveTo || item.effectiveTo >= workDate),
    );
    const windows = computeWindows(workDate, shift, timezone);
    const dateKey = workDate.toISOString().slice(0, 10);
    let result = classifyCheckIn(checkInTime, windows);
    const awards: CheckInPoint[] = [];

    if (result === 'NOT_OPEN') {
      // DN-04: before the shift opens only an active EARLY_WORK offer covering this moment allows check-in.
      const earlyGreens = await this.earlyWorkGreens(
        companyId,
        userId,
        checkInTime,
        windows.scheduledStartAt,
      );
      if (earlyGreens === null) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Check-in is not open yet.',
          error: 'Bad Request',
          code: 'CHECKIN_NOT_OPEN',
        });
      }
      result = PointType.GREEN;
      if (earlyGreens > 0) {
        awards.push({
          pointType: PointType.GREEN,
          quantity: earlyGreens,
          reason: 'Employee checked in early under an early-work offer.',
          idempotencyKey: `ATT_EARLY:${employeeId}:${dateKey}`,
        });
      }
    }
    awards.unshift({
      pointType: result,
      quantity: 1,
      reason: `Attendance check-in classified as ${result}.`,
      idempotencyKey: `ATT:${employeeId}:${dateKey}`,
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
          classification: result,
        },
        tx,
      );

      const pointEntries = [];
      for (const award of awards) {
        pointEntries.push(
          await this.points.addPointEntryForSource(
            {
              companyId,
              employeeId,
              ...award,
              sourceType: 'ATTENDANCE',
              sourceId: attendance.id,
              createdByUserId: userId,
              asOfDate: workDate,
            },
            tx,
          ),
        );
      }

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
          classification: result,
          locationId: location.locationId,
          pointEntryIds: pointEntries.map((entry) => entry.id),
        },
      });

      return { attendance, pointEntries };
    });
  }

  // Full early hours to reward, or null when no active EARLY_WORK offer covers the check-in moment.
  private async earlyWorkGreens(
    companyId: string,
    userId: string,
    checkInTime: Date,
    scheduledStartAt: Date,
  ): Promise<number | null> {
    const offers = await this.workOffers.listForEmployee(companyId, userId);
    const offer = offers.find(
      (item) =>
        item.offerType === WorkOfferType.EARLY_WORK &&
        item.status === WorkOfferStatus.ACTIVE &&
        item.startsAt <= checkInTime &&
        checkInTime < item.endsAt,
    );
    return offer ? beforeTimeGreens(checkInTime, scheduledStartAt) : null;
  }
}
