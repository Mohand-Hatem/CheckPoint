import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { DecideAttendanceExcuseDto } from "./dto/excuse-decision.dto";

/**
 * REQ-035 (HAS-170): an Admin approves or rejects a PENDING excuse once. A record only:
 * attendance, classification and the point ledger are never touched (05 §4.8, D-23).
 */
@Injectable()
export class AdminAttendanceExcuseDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  decide(companyId: string, adminUserId: string, id: string, dto: DecideAttendanceExcuseDto) {
    return this.prisma.$transaction(async (tx) => {
      const excuse = await tx.attendanceExcuse.findFirst({
        where: { id, companyId },
        select: { attendanceDay: { select: { employee: { select: { userId: true } } } } },
      });
      if (!excuse) throw new NotFoundException("Excuse not found");
      if (excuse.attendanceDay.employee.userId === adminUserId) {
        throw new ForbiddenException({
          statusCode: 403,
          message: "You cannot decide an excuse on your own attendance day.",
          error: "Forbidden",
          code: "SELF_DECISION_FORBIDDEN",
        });
      }

      // Only the request that flips PENDING may decide: a repeat or the loser of a race updates nothing.
      const { count } = await tx.attendanceExcuse.updateMany({
        where: { id, companyId, status: "PENDING" },
        data: {
          status: dto.decision,
          decisionReason: dto.decisionReason,
          decidedByUserId: adminUserId,
          decidedAt: new Date(),
        },
      });
      if (count === 0) {
        throw new ConflictException({
          statusCode: 409,
          message: "This excuse has already been decided.",
          error: "Conflict",
          code: "EXCUSE_ALREADY_DECIDED",
        });
      }

      await this.audit.record(tx, {
        companyId,
        actorUserId: adminUserId,
        actorType: "ADMIN",
        action: "attendance_excuse.decide",
        targetType: "attendance_excuse",
        targetId: id,
        reason: dto.decisionReason,
        changes: { before: { status: "PENDING" }, after: { status: dto.decision } },
      });

      return tx.attendanceExcuse.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          attendanceDayId: true,
          employeeReason: true,
          status: true,
          decisionReason: true,
          submittedByUserId: true,
          decidedByUserId: true,
          createdAt: true,
          decidedAt: true,
        },
      });
    });
  }
}
