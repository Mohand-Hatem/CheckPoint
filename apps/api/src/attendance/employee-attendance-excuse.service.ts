import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { ListAttendanceExcusesQuery } from "./dto/attendance-excuse.dto";

// What the employee sees of an excuse (05 §4.8): status and decision, never the decider's identity.
const EXCUSE_FIELDS = {
  id: true,
  attendanceDayId: true,
  employeeReason: true,
  status: true,
  decisionReason: true,
  decidedAt: true,
  createdAt: true,
  attendanceDay: { select: { workDate: true } },
} satisfies Prisma.AttendanceExcuseSelect;

type ExcuseRow = Prisma.AttendanceExcuseGetPayload<{ select: typeof EXCUSE_FIELDS }>;

const toDto = ({ attendanceDay, ...excuse }: ExcuseRow) => ({
  ...excuse,
  workDate: attendanceDay.workDate.toISOString().slice(0, 10),
});

/** REQ-034 (HAS-168): an employee's own attendance excuses. Never touches attendance or points. */
@Injectable()
export class EmployeeAttendanceExcuseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async submit(companyId: string, userId: string, attendanceDayId: string, employeeReason: string) {
    const employeeId = await this.employeeIdFor(companyId, userId);
    // One answer for someone else's, another company's or a missing day: nothing is revealed (AC-REQ-034-02).
    const day = await this.prisma.attendanceDay.findFirst({
      where: { id: attendanceDayId, companyId, employeeId },
      select: { id: true },
    });
    if (!day) throw new NotFoundException("Attendance day not found");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const excuse = await tx.attendanceExcuse.create({
          data: { companyId, attendanceDayId: day.id, submittedByUserId: userId, employeeReason },
          select: EXCUSE_FIELDS,
        });
        await this.audit.record(tx, {
          companyId,
          actorUserId: userId,
          actorType: "EMPLOYEE",
          action: "attendance_excuse.submit",
          targetType: "attendance_excuse",
          targetId: excuse.id,
          changes: { attendanceDayId: day.id },
        });
        return toDto(excuse);
      });
    } catch (error) {
      // attendance_day_id is unique: one excuse per day, never resubmitted (AC-REQ-034-03).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({
          statusCode: 409,
          message: "This attendance day already has an excuse.",
          error: "Conflict",
          code: "EXCUSE_EXISTS",
        });
      }
      throw error;
    }
  }

  async listMine(companyId: string, userId: string, query: ListAttendanceExcusesQuery) {
    const where = { companyId, submittedByUserId: userId };
    const [rows, total] = await Promise.all([
      this.prisma.attendanceExcuse.findMany({
        where,
        select: EXCUSE_FIELDS,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.attendanceExcuse.count({ where }),
    ]);
    return {
      items: rows.map(toDto),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async getMine(companyId: string, userId: string, id: string) {
    const excuse = await this.prisma.attendanceExcuse.findFirst({
      where: { id, companyId, submittedByUserId: userId },
      select: EXCUSE_FIELDS,
    });
    if (!excuse) throw new NotFoundException("Excuse not found");
    return toDto(excuse);
  }

  private async employeeIdFor(companyId: string, userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, userId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException("No employee profile is linked to this account.");
    return employee.id;
  }
}
