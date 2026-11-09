import "reflect-metadata";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceValidationService } from "./attendance-validation.service";

describe("AttendanceValidationService (TEST-045)", () => {
  const companyId = "c0ffee00-0000-4000-8000-000000000001";
  const employeeId = "c0ffee00-0000-4000-8000-000000000002";
  const workDate = new Date("2026-11-08T00:00:00.000Z");

  function createService(
    attendance: {
      checkInAt: Date | null;
      checkOutAt: Date | null;
    } | null,
  ) {
    const prisma = {
      attendanceDay: {
        findUnique: jest.fn().mockResolvedValue(attendance),
      },
    };
    const service = new AttendanceValidationService(
      prisma as unknown as PrismaService,
    );
    return { service, prisma };
  }

  it("allows check-in when no attendance row exists", async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.assertCanCheckIn(companyId, employeeId, workDate),
    ).resolves.toBeUndefined();
    expect(prisma.attendanceDay.findUnique.mock.calls[0][0].where).toEqual({
      companyId_employeeId_workDate: { companyId, employeeId, workDate },
    });
  });

  it("rejects a second check-in for the same company, employee, and date", async () => {
    const { service } = createService({
      checkInAt: new Date("2026-11-08T06:00:00.000Z"),
      checkOutAt: null,
    });

    await expect(
      service.assertCanCheckIn(companyId, employeeId, workDate),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("requires a prior check-in before checkout", async () => {
    const { service } = createService(null);

    await expect(
      service.assertCanCheckOut(companyId, employeeId, workDate),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows checkout after check-in when no checkout is recorded", async () => {
    const { service } = createService({
      checkInAt: new Date("2026-11-08T06:00:00.000Z"),
      checkOutAt: null,
    });

    await expect(
      service.assertCanCheckOut(companyId, employeeId, workDate),
    ).resolves.toBeUndefined();
  });

  it("rejects a second checkout", async () => {
    const { service } = createService({
      checkInAt: new Date("2026-11-08T06:00:00.000Z"),
      checkOutAt: new Date("2026-11-08T14:00:00.000Z"),
    });

    await expect(
      service.assertCanCheckOut(companyId, employeeId, workDate),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
