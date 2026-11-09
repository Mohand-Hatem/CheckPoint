import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AttendanceValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanCheckIn(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<void> {
    const attendance = await this.prisma.attendanceDay.findUnique({
      where: {
        companyId_employeeId_workDate: { companyId, employeeId, workDate },
      },
      select: { checkInAt: true },
    });

    if (attendance?.checkInAt) {
      throw new ConflictException("Employee has already checked in.");
    }
  }

  async assertCanCheckOut(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ) {
    const attendance = await this.prisma.attendanceDay.findUnique({
      where: {
        companyId_employeeId_workDate: { companyId, employeeId, workDate },
      },
      select: { id: true, checkInAt: true, checkOutAt: true, scheduledEndAt: true },
    });

    if (!attendance?.checkInAt) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: "Employee must check in before checking out.",
        error: "Unprocessable Entity",
        code: "INVALID_STATE",
      });
    }
    if (attendance.checkOutAt) {
      throw alreadyCheckedOut();
    }
    return attendance;
  }
}

export function alreadyCheckedOut() {
  return new ConflictException({
    statusCode: 409,
    message: "Employee has already checked out.",
    error: "Conflict",
    code: "ALREADY_CHECKED_OUT",
  });
}
