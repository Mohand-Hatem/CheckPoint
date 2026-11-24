import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  AttendanceExcuseSearchQuery,
  AttendanceExcuseStatus,
} from "./dto/attendance-excuse.dto";
import { EmployeeAttendanceExcuseService } from "./employee-attendance-excuse.service";

describe("EmployeeAttendanceExcuseService.reviewExcuses", () => {
  it("filters by the linked attendance day and returns employee identity", async () => {
    const workDate = new Date("2026-03-15T00:00:00.000Z");
    const createdAt = new Date("2026-03-16T12:00:00.000Z");
    const employee = {
      id: "employee-1",
      fullName: "Example Employee",
      employeeNumber: "EMP-001",
    };
    const row = {
      id: "excuse-1",
      attendanceDayId: "day-1",
      employeeReason: "Transit delay",
      status: AttendanceExcuseStatus.PENDING,
      decisionReason: null,
      decidedAt: null,
      createdAt,
      attendanceDay: { workDate, employee },
    };
    const prisma = {
      attendanceExcuse: {
        findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new EmployeeAttendanceExcuseService(
      prisma as unknown as PrismaService,
      {} as AuditService,
    );
    const query: AttendanceExcuseSearchQuery = {
      employeeId: employee.id,
      from: "2026-03-01",
      to: "2026-03-31",
      status: AttendanceExcuseStatus.PENDING,
      page: 2,
      limit: 10,
    };

    await expect(service.reviewExcuses("company-1", query)).resolves.toEqual({
      items: [
        {
          id: "excuse-1",
          attendanceDayId: "day-1",
          employeeReason: "Transit delay",
          status: AttendanceExcuseStatus.PENDING,
          decisionReason: null,
          decidedAt: null,
          createdAt,
          workDate: "2026-03-15",
          employee,
        },
      ],
      pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });

    const expectedWhere = {
      companyId: "company-1",
      status: AttendanceExcuseStatus.PENDING,
      attendanceDay: {
        employeeId: employee.id,
        workDate: {
          gte: new Date("2026-03-01"),
          lte: new Date("2026-03-31"),
        },
      },
    };
    expect(prisma.attendanceExcuse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 10, take: 10 }),
    );
    expect(prisma.attendanceExcuse.count).toHaveBeenCalledWith({ where: expectedWhere });
  });
});
