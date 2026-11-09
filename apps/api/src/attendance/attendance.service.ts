import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AttendanceDay, PointType, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { CompanyPolicyService } from "../company/company-policy.service";
import { resolvePointValue } from "../points/point-value";
import { PrismaService } from "../prisma/prisma.service";
import {
  classifyCheckIn,
  computeWindows,
  overtimeGreens,
} from "./attendance-rules";
import { CorrectAttendanceDto } from "./dto/correct-attendance.dto";
import { ListAttendanceQuery } from "./dto/list-attendance.query";

const ATTENDANCE_SOURCES = ["ATTENDANCE", "OVERTIME"];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyPolicy: CompanyPolicyService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string, query: ListAttendanceQuery) {
    const where: Prisma.AttendanceDayWhereInput = {
      companyId,
      ...(query.employeeId && { employeeId: query.employeeId }),
      ...((query.from || query.to) && {
        workDate: {
          ...(query.from && { gte: parseDate(query.from) }),
          ...(query.to && { lte: parseDate(query.to) }),
        },
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendanceDay.findMany({
        where,
        orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          employee: {
            select: { id: true, employeeNumber: true, fullName: true },
          },
        },
      }),
      this.prisma.attendanceDay.count({ where }),
    ]);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  /** FR-ATT-7: the signed-in employee's own days of one month (`YYYY-MM`, default: current company month). */
  async listMine(companyId: string, userId: string, month?: string) {
    if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException("month must be YYYY-MM");
    }
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, userId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException("No employee profile is linked to this account.");

    const value = month ?? (await this.companyPolicy.getCompanyDate(companyId)).toISOString().slice(0, 7);
    const [year, monthIndex] = value.split("-").map(Number);
    const days = await this.prisma.attendanceDay.findMany({
      where: {
        companyId,
        employeeId: employee.id,
        workDate: { gte: new Date(Date.UTC(year, monthIndex - 1, 1)), lt: new Date(Date.UTC(year, monthIndex, 1)) },
      },
      orderBy: { workDate: "asc" },
      select: {
        id: true,
        workDate: true,
        checkInAt: true,
        checkOutAt: true,
        checkInResult: true,
        classification: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
      },
    });
    return {
      month: value,
      days: days.map((day) => ({ ...day, workDate: day.workDate.toISOString().slice(0, 10) })),
    };
  }

  // The day as it is now, every ledger entry it produced, and its correction history (originals included).
  async findOne(companyId: string, id: string) {
    const day = await this.prisma.attendanceDay.findFirst({
      where: { id, companyId },
      include: {
        employee: {
          select: { id: true, employeeNumber: true, fullName: true },
        },
      },
    });
    if (!day) {
      throw new NotFoundException("Attendance day not found");
    }
    const [entries, corrections] = await Promise.all([
      this.prisma.pointLedgerEntry.findMany({
        where: {
          companyId,
          sourceId: id,
          sourceType: { in: ATTENDANCE_SOURCES },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.auditEvent.findMany({
        where: { companyId, targetType: "attendance_day", targetId: id },
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { id: true, email: true } } },
      }),
    ]);
    return {
      ...day,
      pointEntries: entries.map((e) => ({
        ...e,
        valuePerPointPiasters: e.valuePerPointPiasters.toString(),
      })),
      corrections,
    };
  }

  async correct(
    companyId: string,
    adminUserId: string,
    dto: CorrectAttendanceDto,
  ) {
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException(
        "A reason is required to correct attendance.",
      );
    }
    const workDate = parseDate(dto.workDate);
    const at = dto.action === "EXEMPT" ? null : new Date(dto.at ?? "");
    if (at && Number.isNaN(at.getTime())) {
      throw new BadRequestException("`at` must be a valid ISO date-time.");
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException("Employee not found");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const day =
          (await tx.attendanceDay.findUnique({
            where: {
              companyId_employeeId_workDate: {
                companyId,
                employeeId: employee.id,
                workDate,
              },
            },
          })) ??
          (await tx.attendanceDay.create({
            data: {
              companyId,
              employeeId: employee.id,
              workDate,
              ...(await this.scheduleFor(tx, companyId, employee.id, workDate)),
            },
          }));

        const checkInAt = dto.action === "SET_CHECK_IN" ? at : day.checkInAt;
        const checkOutAt = dto.action === "SET_CHECK_OUT" ? at : day.checkOutAt;
        let classification: PointType | null = null;
        if (dto.action !== "EXEMPT") {
          if (!checkInAt) {
            throw new BadRequestException(
              "Set a check-in before the check-out.",
            );
          }
          if (checkOutAt && checkOutAt <= checkInAt) {
            throw new BadRequestException("Check-out must be after check-in.");
          }
          const result = classifyCheckIn(checkInAt, day);
          if (result === "NOT_OPEN") {
            throw new BadRequestException(
              "The check-in is before the shift opens.",
            );
          }
          classification = result;
        }

        // Compensate, never edit: reverse every live attendance/overtime entry of the day.
        const live = await tx.pointLedgerEntry.findMany({
          where: {
            companyId,
            sourceId: day.id,
            sourceType: { in: ATTENDANCE_SOURCES },
            entryKind: "AWARD",
            reversalEntries: { none: {} },
          },
        });
        for (const entry of live) {
          await tx.pointLedgerEntry.create({
            data: {
              companyId,
              employeeId: employee.id,
              pointType: entry.pointType,
              entryKind: "REVERSAL",
              direction: -1,
              quantity: entry.quantity,
              pointValueVersionId: entry.pointValueVersionId,
              valuePerPointPiasters: entry.valuePerPointPiasters,
              sourceType: entry.sourceType,
              sourceId: day.id,
              idempotencyKey: `attendance-reversal:${entry.id}`,
              reversesEntryId: entry.id,
              reason,
              createdByUserId: adminUserId,
            },
          });
        }

        // Revision number makes a concurrent correction clash on the unique key (→ 409).
        const rev =
          (await tx.pointLedgerEntry.count({
            where: {
              companyId,
              sourceId: day.id,
              sourceType: "ATTENDANCE",
              entryKind: "AWARD",
            },
          })) + 1;
        const award = async (
          sourceType: string,
          pointType: PointType,
          quantity: number,
          key: string,
        ) =>
          tx.pointLedgerEntry.create({
            data: {
              companyId,
              employeeId: employee.id,
              pointType,
              entryKind: "AWARD",
              direction: 1,
              quantity,
              ...(await resolvePointValue(tx, companyId, pointType, workDate)),
              sourceType,
              sourceId: day.id,
              idempotencyKey: key,
              reason,
              createdByUserId: adminUserId,
            },
          });

        if (classification) {
          await award("ATTENDANCE", classification, 1, `ATT:${day.id}:${rev}`);
          const overtime = checkOutAt
            ? overtimeGreens(checkOutAt, day.scheduledEndAt)
            : 0;
          if (overtime > 0) {
            await award(
              "OVERTIME",
              PointType.GREEN,
              overtime,
              `OT:${day.id}:${rev}`,
            );
          }
        }

        const updated = await tx.attendanceDay.update({
          where: { id: day.id },
          data: {
            checkInAt,
            checkOutAt,
            classification,
            checkInResult: dto.action === "EXEMPT" ? "EXEMPT" : "CORRECTED",
          },
        });

        await this.audit.record(tx, {
          companyId,
          actorUserId: adminUserId,
          actorType: "ADMIN",
          action: "attendance.correct",
          targetType: "attendance_day",
          targetId: day.id,
          reason,
          changes: {
            action: dto.action,
            workDate: dto.workDate,
            employeeId: employee.id,
            before: snapshot(day),
            after: snapshot(updated),
            reversedEntryIds: live.map((entry) => entry.id),
          },
        });

        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "This day was corrected at the same time by someone else. Reload and try again.",
        );
      }
      throw error;
    }
  }

  // The shift on that date, snapshotted so later shift changes never re-classify the day.
  private async scheduleFor(
    tx: Prisma.TransactionClient,
    companyId: string,
    employeeId: string,
    workDate: Date,
  ) {
    const covers = {
      effectiveFrom: { lte: workDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
    };
    const assignment = await tx.shiftAssignment.findFirst({
      where: { companyId, employeeId, ...covers },
      select: { id: true, shiftId: true },
    });
    const version =
      assignment &&
      (await tx.shiftVersion.findFirst({
        where: { companyId, shiftId: assignment.shiftId, ...covers },
        include: { weekdays: true },
      }));
    if (
      !assignment ||
      !version?.weekdays.some((w) => w.weekday === workDate.getUTCDay())
    ) {
      throw new BadRequestException(
        "This date is not a working day for the employee.",
      );
    }
    const timezone = await this.companyPolicy.getTimezone(companyId, workDate);
    return {
      shiftAssignmentId: assignment.id,
      timezone,
      ...computeWindows(workDate, version, timezone),
    };
  }
}

function snapshot(day: AttendanceDay) {
  return {
    checkInAt: day.checkInAt?.toISOString() ?? null,
    checkOutAt: day.checkOutAt?.toISOString() ?? null,
    classification: day.classification,
    checkInResult: day.checkInResult,
  };
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !DATE_ONLY.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException("Dates must be valid YYYY-MM-DD values.");
  }
  return date;
}
