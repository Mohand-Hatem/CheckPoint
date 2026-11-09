import {
  BadRequestException,
  ConflictException,
  Injectable,
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
  ): Promise<void> {
    const attendance = await this.prisma.attendanceDay.findUnique({
      where: {
        companyId_employeeId_workDate: { companyId, employeeId, workDate },
      },
      select: { checkInAt: true, checkOutAt: true },
    });

    if (!attendance?.checkInAt) {
      throw new BadRequestException(
        "Employee must check in before checking out.",
      );
    }
    if (attendance.checkOutAt) {
      throw new ConflictException("Employee has already checked out.");
    }
  }
}
