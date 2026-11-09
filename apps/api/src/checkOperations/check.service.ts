import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AttendanceVerification,
  PointType,
  Prisma,
  VerificationStatus,
  WorkOfferStatus,
  WorkOfferType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AttendanceDayService } from '../attendance/attendance-day.service';
import {
  alreadyCheckedIn,
  alreadyCheckedOut,
  AttendanceValidationService,
} from '../attendance/attendance-validation.service';
import {
  beforeTimeGreens,
  classifyCheckIn,
  computeWindows,
  overtimeGreens,
  ShiftTimes,
} from '../attendance/attendance-rules';
import { CompanyPolicyService } from '../company/company-policy.service';
import { EmployeesService } from '../employees/employees.service';
import { LocationService } from '../location/location.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkOffersService } from '../work-offers/work-offers.service';
import { PositionDto } from './dto/check.dto';

type CheckInPoint = {
  pointType: PointType;
  quantity: number;
  reason: string;
  idempotencyKey: string;
};

const VERIFICATION_TTL_MS = 15 * 60_000; // FR-ATT-1: the QR must be scanned within 15 minutes

const toVerificationResponse = (verification: AttendanceVerification) => ({
  verificationId: verification.id,
  locationId: verification.locationId,
  status: verification.status,
  expiresAt: verification.expiresAt,
});

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

  async checkInAsUser(companyId: string, userId: string, position: PositionDto) {
    return this.checkIn(companyId, await this.employeeIdFor(companyId, userId), position);
  }

  async confirmCheckInAsUser(companyId: string, userId: string, verificationId: string, qrToken: string) {
    return this.confirmCheckIn(companyId, await this.employeeIdFor(companyId, userId), verificationId, qrToken);
  }

  async checkOutAsUser(companyId: string, userId: string, position: PositionDto) {
    return this.checkOut(companyId, await this.employeeIdFor(companyId, userId), position);
  }

  /** Step 1 (docs/05 §4.2): GPS + geofence create a 15-minute PENDING verification. Nothing is awarded. */
  async checkIn(companyId: string, employeeId: string, position: PositionDto) {
    const now = new Date();
    const plan = await this.planCheckIn(companyId, employeeId, now);
    const { workDate } = plan;
    await this.attendanceValidation.assertCanCheckIn(companyId, employeeId, workDate);

    const live = { companyId, employeeId, workDate, status: VerificationStatus.PENDING, expiresAt: { gt: now } };
    const existing = await this.prisma.attendanceVerification.findFirst({ where: live });
    if (existing) return toVerificationResponse(existing);

    const location = await this.assertAtAllowedLocation(companyId, plan.userId, 'CHECKIN', position);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // An expired PENDING row would block the one-pending-per-day index.
        await tx.attendanceVerification.updateMany({
          where: { companyId, employeeId, workDate, status: VerificationStatus.PENDING, expiresAt: { lte: now } },
          data: { status: VerificationStatus.EXPIRED },
        });
        return tx.attendanceVerification.create({
          data: {
            companyId,
            employeeId,
            workDate,
            locationId: location.locationId,
            startedAt: now,
            expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
            latitude: position.lat,
            longitude: position.lng,
            accuracyM: position.accuracy,
          },
        });
      });
      return toVerificationResponse(created);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      // A concurrent request created the pending row first: answer with it.
      const winner = await this.prisma.attendanceVerification.findFirst({ where: live });
      if (!winner) throw error;
      return toVerificationResponse(winner);
    }
  }

  /** Step 2 (docs/05 §4.3): the kiosk QR confirms the verification and records the day at the step-1 time. */
  async confirmCheckIn(companyId: string, employeeId: string, verificationId: string, qrToken: string) {
    const now = new Date();
    const verification = await this.prisma.attendanceVerification.findFirst({
      where: { id: verificationId, companyId, employeeId },
    });
    if (!verification) throw new NotFoundException('Verification not found');
    if (verification.status === VerificationStatus.CONFIRMED) throw alreadyCheckedIn();
    if (verification.status === VerificationStatus.EXPIRED || verification.expiresAt <= now) {
      await this.prisma.attendanceVerification.updateMany({
        where: { id: verification.id, status: VerificationStatus.PENDING },
        data: { status: VerificationStatus.EXPIRED },
      });
      throw new GoneException({
        statusCode: 410,
        message: 'The check-in expired. Check in with GPS again, then scan the QR code within 15 minutes.',
        error: 'Gone',
        code: 'VERIFICATION_EXPIRED',
      });
    }
    await this.locations.verifyQrToken(companyId, verification.locationId, qrToken);
    return this.recordCheckIn(
      await this.planCheckIn(companyId, employeeId, verification.startedAt),
      verification.id,
      verification.locationId,
      now,
    );
  }

  /** Classification and points for a check-in at `at` (D-17 early-work rule included). Writes nothing. */
  private async planCheckIn(companyId: string, employeeId: string, at: Date) {
    const checkInTime = at;
    const { employee, userId } = await this.activeEmployee(companyId, employeeId);

    const timezone = await this.companyPolicy.getTimezone(
      companyId,
      checkInTime,
    );
    const workDate = await this.companyPolicy.getCompanyDate(
      companyId,
      checkInTime,
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

    return { companyId, employeeId, userId, checkInTime, timezone, workDate, windows, assignment, result, awards };
  }

  private async recordCheckIn(
    plan: Awaited<ReturnType<CheckService['planCheckIn']>>,
    verificationId: string,
    locationId: string,
    now: Date,
  ) {
    const { companyId, employeeId, userId, checkInTime, timezone, workDate, windows, assignment, result, awards } = plan;
    return this.prisma.$transaction(async (tx) => {
      // Only the request that flips PENDING to CONFIRMED may record the day, so a double scan cannot award twice.
      const { count } = await tx.attendanceVerification.updateMany({
        where: { id: verificationId, status: VerificationStatus.PENDING },
        data: { status: VerificationStatus.CONFIRMED, confirmedAt: now },
      });
      if (count === 0) throw alreadyCheckedIn();

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
          locationId,
          verificationId,
          pointEntryIds: pointEntries.map((entry) => entry.id),
        },
      });

      return { attendance, pointEntries };
    });
  }

  async checkOut(companyId: string, employeeId: string, position: PositionDto) {
    const checkOutAt = new Date();
    const { userId } = await this.activeEmployee(companyId, employeeId);
    const workDate = await this.companyPolicy.getCompanyDate(companyId, checkOutAt);
    const day = await this.attendanceValidation.assertCanCheckOut(companyId, employeeId, workDate);
    const location = await this.assertAtAllowedLocation(companyId, userId, 'CHECKOUT', position);
    // shortcut: an approved early leave must force 0 here (FR-ATT-5); early-leave requests arrive in Phase 5.
    const overtime = overtimeGreens(checkOutAt, day.scheduledEndAt);

    return this.prisma.$transaction(async (tx) => {
      // Only the request that flips check_out_at from NULL may continue, so retries and races cannot award twice.
      const { count } = await tx.attendanceDay.updateMany({
        where: { id: day.id, companyId, employeeId, checkOutAt: null },
        data: { checkOutAt },
      });
      if (count === 0) throw alreadyCheckedOut();

      const pointEntry =
        overtime > 0
          ? await this.points.addPointEntryForSource(
              {
                companyId,
                employeeId,
                pointType: PointType.GREEN,
                quantity: overtime,
                reason: `Overtime: ${overtime} full hour(s) after the shift end.`,
                idempotencyKey: `OT:${day.id}:checkout`,
                sourceType: 'OVERTIME',
                sourceId: day.id,
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
        action: 'attendance.check_out',
        targetType: 'attendance_day',
        targetId: day.id,
        changes: {
          checkOutAt: checkOutAt.toISOString(),
          overtimeGreens: overtime,
          locationId: location.locationId,
          pointEntryId: pointEntry?.id ?? null,
        },
      });

      return { checkOutAt, overtimeGreens: overtime };
    });
  }

  private async employeeIdFor(companyId: string, userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, userId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('No employee profile is linked to this account.');
    }
    return employee.id;
  }

  private async activeEmployee(companyId: string, employeeId: string) {
    const employee = await this.employees.findOne(companyId, employeeId);
    if (!employee.isActive || !employee.user?.id || !employee.user.isActive) {
      throw new ForbiddenException('An active employee login is required.');
    }
    return { employee, userId: employee.user.id };
  }

  private async assertAtAllowedLocation(
    companyId: string,
    userId: string,
    operation: 'CHECKIN' | 'CHECKOUT',
    position: PositionDto,
  ) {
    if (position.accuracy > (await this.companyPolicy.getGpsMaxAccuracyM(companyId))) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'GPS accuracy is too low. Move to an open area and try again.',
        error: 'Unprocessable Entity',
        code: 'GPS_ACCURACY_TOO_LOW',
      });
    }
    return this.locations.isInAllowedLocation(userId, companyId, operation, {
      latitude: position.lat,
      longitude: position.lng,
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
