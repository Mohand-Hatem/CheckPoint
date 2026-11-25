import { BadRequestException } from "@nestjs/common";
import { PointType, Prisma } from "@prisma/client";
import { CompanyPolicyService } from "../company/company-policy.service";
import { PrismaService } from "../prisma/prisma.service";
import { WorkOffersService } from "../work-offers/work-offers.service";
import { SalaryCalculationService } from "./salaryCalculation.service";

describe("SalaryCalculationService", () => {
  const companyId = "company-1";
  const employeeId = "employee-1";
  const range = {
    startDate: new Date("2026-11-01T00:00:00.000Z"),
    endDate: new Date("2026-11-30T23:59:59.999Z"),
  };

  const makeService = (overrides?: {
    prisma?: Partial<Record<string, unknown>>;
    workOffers?: Partial<WorkOffersService>;
    policy?: Partial<CompanyPolicyService>;
  }) => {
    const prisma = {
      employeeSalaryVersion: { findMany: jest.fn().mockResolvedValue([]) },
      attendanceDay: { findMany: jest.fn().mockResolvedValue([]) },
      pointLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
      pointOffsetAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides?.prisma,
    } as unknown as PrismaService;

    const workOffers = {
      offDaysWork: jest.fn().mockResolvedValue([]),
      ...overrides?.workOffers,
    } as unknown as WorkOffersService;

    const policy = {
      getPreviousMonthRange: jest.fn().mockResolvedValue(range),
      getPolicyVersions: jest.fn().mockResolvedValue([]),
      ...overrides?.policy,
    } as unknown as CompanyPolicyService;

    return {
      prisma,
      workOffers,
      policy,
      service: new SalaryCalculationService(prisma, workOffers, policy),
    };
  };

  it("TEST-CALC-01: uses the salary version effective at the period end", async () => {
    const { service } = makeService({
      prisma: {
        employeeSalaryVersion: {
          findMany: jest.fn().mockResolvedValue([
            {
              effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
              effectiveTo: new Date("2026-11-15T23:59:59.999Z"),
              salary: new Prisma.Decimal("10000"),
            },
            {
              effectiveFrom: new Date("2026-11-16T00:00:00.000Z"),
              effectiveTo: null,
              salary: new Prisma.Decimal("12000"),
            },
          ]),
        },
      },
    });

    await expect(service.baseSalary(companyId, employeeId, range)).resolves.toEqual(
      new Prisma.Decimal("12000"),
    );
  });

  it("TEST-CALC-02: rejects a period with no salary version", async () => {
    const { service } = makeService();

    await expect(service.baseSalary(companyId, employeeId, range)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("TEST-CALC-03: pays one off-day exception at salary / 30 multiplied by 3", async () => {
    const { service } = makeService({
      workOffers: {
        offDaysWork: jest.fn().mockResolvedValue([{ id: "offer-1" }]),
      },
      prisma: {
        employeeSalaryVersion: {
          findMany: jest.fn().mockResolvedValue([
            {
              effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
              effectiveTo: null,
              salary: new Prisma.Decimal("10000"),
            },
          ]),
        },
      },
    });

    await expect(service.calculateOffDays(companyId, employeeId, range)).resolves.toEqual(
      new Prisma.Decimal("1000"),
    );
  });

  it("TEST-CALC-04: returns zero off-day pay when no exception was worked", async () => {
    const { service } = makeService();

    await expect(service.calculateOffDays(companyId, employeeId, range)).resolves.toEqual(
      new Prisma.Decimal("0"),
    );
  });

  it("TEST-CALC-05: deducts approved early-checkout time at the minute rate", async () => {
    const checkout = new Date("2026-11-10T14:00:00.000Z");
    const scheduledEnd = new Date("2026-11-10T15:00:00.000Z");
    const { service } = makeService({
      prisma: {
        attendanceDay: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "attendance-1",
              workDate: new Date("2026-11-10T00:00:00.000Z"),
              checkOutAt: checkout,
              scheduledEndAt: scheduledEnd,
            },
          ]),
        },
        employeeSalaryVersion: {
          findMany: jest.fn().mockResolvedValue([
            {
              effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
              effectiveTo: null,
              salary: new Prisma.Decimal("30000"),
            },
          ]),
        },
      },
      policy: {
        getPolicyVersions: jest.fn().mockResolvedValue([
          {
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
            effectiveTo: null,
            monthlyHoursDivisor: 240,
          },
        ]),
      },
    });

    const result = await service.leaveDeduction(companyId, employeeId, range);

    expect(result.totalMinutes).toBe(60);
    expect(result.deduction).toEqual(new Prisma.Decimal("125"));
  });

  it("TEST-CALC-06: credits only unconsumed GREEN points", async () => {
    const { service } = makeService({
      prisma: {
        pointLedgerEntry: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "green-1",
              quantity: 10,
              valuePerPointPiasters: new Prisma.Decimal("2500"),
            },
          ]),
        },
        pointOffsetAllocation: {
          findMany: jest.fn().mockResolvedValue([
            { greenEntryId: "green-1", quantity: 3, reversesAllocationId: null },
            { greenEntryId: "green-1", quantity: 1, reversesAllocationId: "undo-1" },
          ]),
        },
      },
    });

    await expect(service.fundCredit(companyId, employeeId, range)).resolves.toEqual(
      new Prisma.Decimal("200"),
    );
  });

  it("TEST-CALC-07: deducts only unoffset RED and BLACK quantities", async () => {
    const { service } = makeService({
      prisma: {
        pointLedgerEntry: {
          findMany: jest.fn().mockImplementation(({ where }) =>
            Promise.resolve(
              where.pointType === PointType.RED
                ? [{ id: "red-1", quantity: 3, valuePerPointPiasters: new Prisma.Decimal("25000") }]
                : [{ id: "black-1", quantity: 2, valuePerPointPiasters: new Prisma.Decimal("100000") }],
            ),
          ),
        },
        pointOffsetAllocation: {
          findMany: jest.fn().mockImplementation(({ where }) => {
            if (where.penaltyEntryId) {
              return Promise.resolve([
                { penaltyEntryId: "red-1", quantity: 1, reversesAllocationId: null },
              ]);
            }
            return Promise.resolve([]);
          }),
        },
      },
    });

    await expect(
      service.appliedRedDeduction(companyId, employeeId, range),
    ).resolves.toEqual(new Prisma.Decimal("500"));
    await expect(
      service.appliedBlackDeduction(companyId, employeeId, range),
    ).resolves.toEqual(new Prisma.Decimal("2000"));
  });

  it("TEST-CALC-08: adds and subtracts all payroll components to produce net salary", async () => {
    const { service } = makeService();

    jest.spyOn(service, "baseSalary").mockResolvedValue(new Prisma.Decimal("20000"));
    jest.spyOn(service, "leaveDeduction").mockResolvedValue({
      totalMinutes: 60,
      deduction: new Prisma.Decimal("200"),
      details: [],
    });
    jest.spyOn(service, "appliedRedDeduction").mockResolvedValue(new Prisma.Decimal("250"));
    jest.spyOn(service, "appliedBlackDeduction").mockResolvedValue(new Prisma.Decimal("1000"));
    jest.spyOn(service, "calculateOffDays").mockResolvedValue(new Prisma.Decimal("333.33"));
    jest.spyOn(service, "fundCredit").mockResolvedValue(new Prisma.Decimal("170"));

    await expect(service.calculateSalary(companyId, employeeId, range)).resolves.toMatchObject({
      baseSalary: new Prisma.Decimal("20000"),
      leaveDeduction: new Prisma.Decimal("200"),
      appliedRedDeduction: new Prisma.Decimal("250"),
      appliedBlackDeduction: new Prisma.Decimal("1000"),
      offDayPay: new Prisma.Decimal("333.33"),
      fundCredit: new Prisma.Decimal("170"),
      netSalary: new Prisma.Decimal("19053.33"),
    });
  });
});
