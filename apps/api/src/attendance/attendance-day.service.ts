import { ConflictException, Injectable } from "@nestjs/common";
import { PointType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type RecordAttendanceDayInput = {
  companyId: string;
  employeeId: string;
  workDate: Date;
  timezone: string;
  shiftAssignmentId?: string | null;
  scheduledStartAt: Date;
  earlyEndAt: Date;
  graceEndAt: Date;
  redPeriodEndAt: Date;
  scheduledEndAt: Date;
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  checkInResult?: string;
  classification?: PointType | null;
};

@Injectable()
export class AttendanceDayService {
  constructor(private readonly prisma: PrismaService) {}

  recordAttendanceDay(
    input: RecordAttendanceDayInput,
    transaction?: Prisma.TransactionClient,
  ) {
    if (transaction) {
      return this.create(transaction, input);
    }

    return this.prisma.$transaction((tx) => this.create(tx, input));
  }

  private create(
    transaction: Prisma.TransactionClient,
    input: RecordAttendanceDayInput,
  ) {
    return transaction.attendanceDay
      .create({
        data: {
          companyId: input.companyId,
          employeeId: input.employeeId,
          workDate: input.workDate,
          timezone: input.timezone,
          shiftAssignmentId: input.shiftAssignmentId,
          scheduledStartAt: input.scheduledStartAt,
          earlyEndAt: input.earlyEndAt,
          graceEndAt: input.graceEndAt,
          redPeriodEndAt: input.redPeriodEndAt,
          scheduledEndAt: input.scheduledEndAt,
          checkInAt: input.checkInAt,
          checkOutAt: input.checkOutAt,
          checkInResult: input.checkInResult,
          classification: input.classification,
        },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new ConflictException(
            "An attendance day already exists for this employee and date.",
          );
        }
        throw error;
      });
  }
}
