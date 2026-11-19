import { Injectable, Logger } from '@nestjs/common';
import { PointType, VerificationStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CalendarService } from '../calendar/calendar.service';
import { CompanyPolicyService } from '../company/company-policy.service';
import { EmployeesService } from '../employees/employees.service';
import { lockEmployee } from '../points/lock-employee';
import { PointAllocationService } from '../points/point-allocation.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeWindows, scheduleForDay } from './attendance-rules';

const DEFAULT_LOOKBACK_DAYS = 7; // docs/08 settings `absence_lookback_days`
const DAY_MS = 86_400_000;

type Candidate = { employeeId: string; workDate: Date };

/**
 * Absence sweep (05 §12, C-26): every working day an employee has no attendance by the end of the
 * red period becomes ABSENT with one BLACK. Idempotent: the attendance row is unique per day and the
 * BLACK uses the check-in day key, so re-runs and parallel runs add nothing. BullMQ only calls `run`.
 */
@Injectable()
export class AbsenceSweepService {
  private readonly logger = new Logger(AbsenceSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyPolicy: CompanyPolicyService,
    private readonly employees: EmployeesService,
    private readonly calendar: CalendarService,
    private readonly points: PointsService,
    private readonly allocation: PointAllocationService,
    private readonly audit: AuditService,
  ) {}

  async run(now = new Date()) {
    // A PENDING check-in past its 15 minutes no longer protects the day (I17).
    const { count: expired } = await this.prisma.attendanceVerification.updateMany({
      where: { status: VerificationStatus.PENDING, expiresAt: { lte: now } },
      data: { status: VerificationStatus.EXPIRED },
    });

    let absences = 0;
    let failed = 0;
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    for (const { id: companyId } of companies) {
      const result = await this.sweepCompany(companyId, now).catch((error: unknown) => {
        this.logger.error(`Absence sweep failed for company ${companyId}`, error instanceof Error ? error.stack : String(error));
        return { absences: 0, failed: 1 };
      });
      absences += result.absences;
      failed += result.failed;
    }
    return { expired, absences, failed };
  }

  private async sweepCompany(companyId: string, now: Date) {
    const timezone = await this.companyPolicy.getTimezone(companyId, now);
    const today = await this.companyPolicy.getCompanyDate(companyId, now);
    const from = new Date(today.getTime() - (await this.lookbackDays(companyId)) * DAY_MS);

    // Cheap set-based filter first; the per-employee transaction re-checks under the lock.
    const candidates = await this.prisma.$queryRaw<Candidate[]>`
      SELECT e.id AS "employeeId", d::date AS "workDate"
      FROM employees e
      CROSS JOIN generate_series(${from}::date, ${today}::date, interval '1 day') d
      WHERE e.company_id = ${companyId}::uuid
        AND e.active_from <= d::date
        AND ((e.is_active AND e.deactivated_at IS NULL)
             OR (e.deactivated_at AT TIME ZONE ${timezone})::date > d::date)
        AND NOT payroll_month_is_locked(e.company_id, d::date)
        AND NOT EXISTS (
          SELECT 1 FROM attendance_days a
          WHERE a.company_id = e.company_id AND a.employee_id = e.id AND a.work_date = d::date)
        AND NOT EXISTS (
          SELECT 1 FROM attendance_verifications v
          WHERE v.company_id = e.company_id AND v.employee_id = e.id AND v.work_date = d::date
            AND v.status = 'PENDING' AND v.expires_at > ${now})
      ORDER BY e.id, d`;

    let absences = 0;
    let failed = 0;
    const employees = new Map<string, Awaited<ReturnType<EmployeesService['findOne']>>>();
    for (const candidate of candidates) {
      try {
        if (!employees.has(candidate.employeeId)) {
          employees.set(candidate.employeeId, await this.employees.findOne(companyId, candidate.employeeId));
        }
        if (await this.markAbsent(companyId, employees.get(candidate.employeeId)!, candidate.workDate, now)) absences++;
      } catch (error) {
        failed++;
        this.logger.error(
          `Absence sweep failed for employee ${candidate.employeeId} on ${candidate.workDate.toISOString().slice(0, 10)}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return { absences, failed };
  }

  private async markAbsent(
    companyId: string,
    employee: Awaited<ReturnType<EmployeesService['findOne']>>,
    workDate: Date,
    now: Date,
  ) {
    // Same day rules as check-in (Task 7): shift in force, company calendar, red-period end.
    const { shift, assignment } = scheduleForDay(employee, workDate);
    if (!shift || !(await this.calendar.isWorkingDay(companyId, workDate))) return false;
    const timezone = await this.companyPolicy.getTimezone(companyId, workDate);
    const windows = computeWindows(workDate, shift, timezone);
    if (now < windows.redPeriodEndAt) return false;

    const employeeId = employee.id;
    const dateKey = workDate.toISOString().slice(0, 10);
    return this.prisma.$transaction(async (tx) => {
      await lockEmployee(tx, employeeId);
      const live = await tx.attendanceVerification.findFirst({
        where: { companyId, employeeId, workDate, status: VerificationStatus.PENDING, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (live) return false;

      const { count } = await tx.attendanceDay.createMany({
        data: [{
          companyId, employeeId, workDate, timezone, shiftAssignmentId: assignment?.id ?? null, ...windows,
          checkInResult: 'ABSENT', classification: PointType.BLACK,
        }],
        skipDuplicates: true, // a check-in or another sweep got there first
      });
      if (count === 0) return false;
      const day = await tx.attendanceDay.findUniqueOrThrow({
        where: { companyId_employeeId_workDate: { companyId, employeeId, workDate } },
        select: { id: true },
      });

      const black = await this.points.addPointEntryForSource({
        companyId, employeeId, pointType: PointType.BLACK, quantity: 1,
        sourceType: 'ATTENDANCE', sourceId: day.id,
        idempotencyKey: `ATT:${employeeId}:${dateKey}`, // the check-in day key: one day point per day
        reason: 'Absent: no check-in by the end of the red period.',
        createdByUserId: null, asOfDate: workDate,
      }, tx);
      await this.audit.record(tx, {
        companyId, actorUserId: null, actorType: 'SYSTEM', action: 'attendance.absent',
        targetType: 'attendance_day', targetId: day.id,
        changes: { workDate: dateKey, classification: PointType.BLACK, pointEntryId: black.id },
      });
      await this.allocation.saveAllocations(companyId, employeeId, tx);
      return true;
    });
  }

  private async lookbackDays(companyId: string) {
    const setting = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: 'absence_lookback_days' } },
      select: { value: true },
    });
    return typeof setting?.value === 'number' ? setting.value : DEFAULT_LOOKBACK_DAYS;
  }
}
