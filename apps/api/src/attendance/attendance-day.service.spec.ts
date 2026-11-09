import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  AttendanceDayService,
  RecordAttendanceDayInput,
} from "./attendance-day.service";

describe("AttendanceDayService.recordAttendanceDay (TEST-046)", () => {
  const input: RecordAttendanceDayInput = {
    companyId: "c0ffee00-0000-4000-8000-000000000001",
    employeeId: "c0ffee00-0000-4000-8000-000000000002",
    workDate: new Date("2026-11-08T00:00:00.000Z"),
    timezone: "Africa/Cairo",
    shiftAssignmentId: "c0ffee00-0000-4000-8000-000000000003",
    scheduledStartAt: new Date("2026-11-08T06:00:00.000Z"),
    earlyEndAt: new Date("2026-11-08T07:00:00.000Z"),
    graceEndAt: new Date("2026-11-08T08:00:00.000Z"),
    redPeriodEndAt: new Date("2026-11-08T10:00:00.000Z"),
    scheduledEndAt: new Date("2026-11-08T14:00:00.000Z"),
  };

  function transactionDb() {
    return {
      attendanceDay: {
        create: jest.fn().mockResolvedValue({ id: "attendance-day-id" }),
      },
    } as unknown as Prisma.TransactionClient;
  }

  it("creates inside its own transaction when no transaction is supplied", async () => {
    const tx = transactionDb();
    const prisma = {
      $transaction: jest.fn(
        async (operation: (client: Prisma.TransactionClient) => unknown) =>
          operation(tx),
      ),
    };
    const service = new AttendanceDayService(
      prisma as unknown as PrismaService,
    );

    await expect(service.recordAttendanceDay(input)).resolves.toEqual({
      id: "attendance-day-id",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.attendanceDay.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: input.companyId,
        employeeId: input.employeeId,
        workDate: input.workDate,
        timezone: input.timezone,
        shiftAssignmentId: input.shiftAssignmentId,
        scheduledStartAt: input.scheduledStartAt,
        scheduledEndAt: input.scheduledEndAt,
      }),
    });
  });

  it("uses the supplied transaction without opening a nested transaction", async () => {
    const tx = transactionDb();
    const prisma = {
      $transaction: jest.fn(),
    };
    const service = new AttendanceDayService(
      prisma as unknown as PrismaService,
    );

    await service.recordAttendanceDay(input, tx);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.attendanceDay.create).toHaveBeenCalledTimes(1);
  });

  it("reports a duplicate employee/date as a conflict", async () => {
    const tx = transactionDb();
    const knownError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" },
    );
    (tx.attendanceDay.create as jest.Mock).mockRejectedValue(knownError);
    const prisma = {
      $transaction: jest.fn(
        async (operation: (client: Prisma.TransactionClient) => unknown) =>
          operation(tx),
      ),
    };
    const service = new AttendanceDayService(
      prisma as unknown as PrismaService,
    );

    await expect(service.recordAttendanceDay(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
