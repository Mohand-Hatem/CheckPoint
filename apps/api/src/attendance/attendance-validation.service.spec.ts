import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceValidationService } from "./attendance-validation.service";

describe("AttendanceValidationService (TEST-045)", () => {
  const companyId = "c0ffee00-0000-4000-8000-000000000001";
  const employeeId = "c0ffee00-0000-4000-8000-000000000002";
  const workDate = new Date("2026-11-08T00:00:00.000Z");

  function createService(
    attendance: Record<string, unknown> | null,
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

  it.each([
    ["no attendance row", null],
    ["a day without a check-in", { checkInAt: null, checkOutAt: null }],
  ])("REQ-014 FR-ATT-5: checkout with %s answers 422 INVALID_STATE", async (_name, day) => {
    const { service } = createService(day);

    await expect(
      service.assertCanCheckOut(companyId, employeeId, workDate),
    ).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({ code: "INVALID_STATE" }),
    });
  });

  it("REQ-014 FR-ATT-5: allows checkout after check-in and returns the day", async () => {
    const day = {
      id: "day-1",
      checkInAt: new Date("2026-11-08T06:00:00.000Z"),
      checkOutAt: null,
      scheduledEndAt: new Date("2026-11-08T14:00:00.000Z"),
    };
    const { service, prisma } = createService(day);

    await expect(
      service.assertCanCheckOut(companyId, employeeId, workDate),
    ).resolves.toEqual(day);
    expect(prisma.attendanceDay.findUnique.mock.calls[0][0].select).toEqual({
      id: true,
      checkInAt: true,
      checkOutAt: true,
      checkInResult: true,
      scheduledEndAt: true,
    });
  });

  it("REQ-014 FR-ATT-5: a second checkout answers 409 ALREADY_CHECKED_OUT", async () => {
    const { service } = createService({
      checkInAt: new Date("2026-11-08T06:00:00.000Z"),
      checkOutAt: new Date("2026-11-08T14:00:00.000Z"),
    });

    await expect(
      service.assertCanCheckOut(companyId, employeeId, workDate),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: "ALREADY_CHECKED_OUT" }),
    });
  });
});
