import { BadRequestException, Injectable } from "@nestjs/common";
import { PointType, Prisma } from "@prisma/client";
import { CompanyPolicyService } from "../company/company-policy.service";
import { PrismaService } from "../prisma/prisma.service";
import { WorkOffersService } from "../work-offers/work-offers.service";

type Versioned = { effectiveFrom: Date; effectiveTo: Date | null };
type DateRange = { startDate: Date; endDate: Date };

const EXCUSE_APPROVED = "APPROVED";
const OFF_DAY_MULTIPLIER = 3; // TODO: make configurable (Setting table)
const DAYS_IN_MONTH = 30; // TODO: derive from company policy

@Injectable()
export class SalaryCalculationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly workOfferService: WorkOffersService,
    private readonly companyPolicy: CompanyPolicyService,
  ) {}

  /*
    netSalary = baseSalary
              - leaveDeduction
              - appliedRed
              - appliedBlack
              + offDayPay
              + fundCredit
  */
  async calculateSalary(
    companyId: string,
    employeeId: string,
    range?: DateRange,
    excludeSourceTypes: string[] = [], 
  ) {
    // One range for everything
    const period = await this.resolveRange(companyId, range);

    const [base, leave, red, black, offDay, fund] = await Promise.all([
      this.baseSalary(companyId, employeeId, period),
      this.leaveDeduction(companyId, employeeId, period),
      this.appliedRedDeduction(companyId, employeeId, period, excludeSourceTypes),
      this.appliedBlackDeduction(companyId, employeeId, period, excludeSourceTypes),
      this.calculateOffDays(companyId, employeeId, period),
      this.fundCredit(companyId, employeeId, period),
    ]);

    const netSalary = base
      .sub(leave.deduction)
      .sub(red)
      .sub(black)
      .add(offDay)
      .add(fund)
      .toDecimalPlaces(2);

    return {
      period,
      baseSalary: base,
      leaveDeduction: leave.deduction,
      appliedRedDeduction: red,
      appliedBlackDeduction: black,
      offDayPay: offDay,
      fundCredit: fund,
      netSalary,
    };
  }


  async baseSalary(companyId: string, employeeId: string, range?: DateRange) {
    const { startDate, endDate } = await this.resolveRange(companyId, range);
    const versions = await this.getSalaryVersions(companyId, employeeId, startDate, endDate);
    const version = this.pickVersion(versions, endDate);
    if (!version) {
      throw new BadRequestException("Employee must have a salary version");
    }
    return version.salary.toDecimalPlaces(2);
  }

  // ------------------------------------------------------------------- off days

  async calculateOffDays(companyId: string, employeeId: string, range?: DateRange) {
    const { startDate, endDate } = await this.resolveRange(companyId, range);

    const workOffDays = await this.workOfferService.offDaysWork(
      companyId,
      employeeId,
      startDate,
      endDate,
    );
    if (workOffDays.length === 0) return new Prisma.Decimal(0);

    const versions = await this.getSalaryVersions(companyId, employeeId, startDate, endDate);
    const version = this.pickVersion(versions, endDate);
    if (!version) {
      throw new BadRequestException("Employee must have a salary version");
    }

    return version.salary
      .div(DAYS_IN_MONTH)
      .mul(OFF_DAY_MULTIPLIER)
      .mul(workOffDays.length)
      .toDecimalPlaces(2);
  }

  // ------------------------------------------------------------ leave deduction

  async leaveDeduction(companyId: string, employeeId: string, range?: DateRange) {
    const { startDate, endDate } = await this.resolveRange(companyId, range);

    const days = await this.prismaService.attendanceDay.findMany({
      where: {
        companyId,
        employeeId,
        workDate: { gte: startDate, lte: endDate },
        leftEarly: true,
        checkOutAt: { not: null },
        excuse: { is: { status: EXCUSE_APPROVED } },
      },
      select: { id: true, workDate: true, checkOutAt: true, scheduledEndAt: true },
      orderBy: { workDate: "asc" },
    });

    if (days.length === 0) {
      return { totalMinutes: 0, deduction: new Prisma.Decimal(0), details: [] };
    }

    const [salaryVersions, policyVersions] = await Promise.all([
      this.getSalaryVersions(companyId, employeeId, startDate, endDate),
      this.companyPolicy.getPolicyVersions(companyId, startDate, endDate),
    ]);

    let totalMinutes = 0;
    let deduction = new Prisma.Decimal(0);
    const details: {
      attendanceDayId: string;
      workDate: Date;
      missedMinutes: number;
      amount: Prisma.Decimal;
    }[] = [];

    for (const day of days) {
      const salary = this.pickVersion(salaryVersions, day.workDate);
      const policy = this.pickVersion(policyVersions, day.workDate);
      if (!salary || !policy) {
        throw new BadRequestException(
          `Missing salary or policy version for ${day.workDate.toISOString().slice(0, 10)}`,
        );
      }

      const missedMinutes = Math.max(
        0,
        Math.round((day.scheduledEndAt.getTime() - day.checkOutAt!.getTime()) / 60_000),
      );

      const minuteRate = salary.salary.div(policy.monthlyHoursDivisor).div(60);
      const amount = minuteRate.mul(missedMinutes);

      totalMinutes += missedMinutes;
      deduction = deduction.add(amount);
      details.push({
        attendanceDayId: day.id,
        workDate: day.workDate,
        missedMinutes,
        amount: amount.toDecimalPlaces(2),
      });
    }

    return { totalMinutes, deduction: deduction.toDecimalPlaces(2), details };
  }

  // ---------------------------------------------------------------- fund credit

  async fundCredit(companyId: string, employeeId: string, range?: DateRange) {
    const { startDate, endDate } = await this.resolveRange(companyId, range);

    const greens = await this.prismaService.pointLedgerEntry.findMany({
      where: {
        companyId,
        employeeId,
        pointType: PointType.GREEN,
        entryKind: "AWARD",
        workDate: { gte: startDate, lte: endDate },
        reversalEntries: { none: {} },
      },
      select: { id: true, quantity: true, valuePerPointPiasters: true },
    });
    if (greens.length === 0) return new Prisma.Decimal(0);

    const allocations = await this.prismaService.pointOffsetAllocation.findMany({
      where: { companyId, greenEntryId: { in: greens.map((g) => g.id) } },
      select: { greenEntryId: true, quantity: true, reversesAllocationId: true },
    });

    const used = new Map<string, number>();
    for (const a of allocations) {
      const signed = a.reversesAllocationId ? -a.quantity : a.quantity;
      used.set(a.greenEntryId, (used.get(a.greenEntryId) ?? 0) + signed);
    }

    let total = new Prisma.Decimal(0);
    for (const g of greens) {
      const remaining = Math.max(0, g.quantity - (used.get(g.id) ?? 0));
      const pounds = new Prisma.Decimal(g.valuePerPointPiasters.toString()).div(100);
      total = total.add(pounds.mul(remaining));
    }
    return total.toDecimalPlaces(2);
  }

  // ------------------------------------------------------- applied red / black

  appliedRedDeduction(
    companyId: string,
    employeeId: string,
    range?: DateRange,
    excludeSourceTypes: string[] = [],
  ) {
    return this.appliedPenaltyDeduction(companyId, employeeId, PointType.RED, range, excludeSourceTypes);
  }

  appliedBlackDeduction(
    companyId: string,
    employeeId: string,
    range?: DateRange,
    excludeSourceTypes: string[] = [],
  ) {
    return this.appliedPenaltyDeduction(companyId, employeeId, PointType.BLACK, range, excludeSourceTypes);
  }

  private async appliedPenaltyDeduction(
    companyId: string,
    employeeId: string,
    pointType: "RED" | "BLACK",
    range?: DateRange,
    excludeSourceTypes: string[] = [],
  ) {
    const { startDate, endDate } = await this.resolveRange(companyId, range);

    const penalties = await this.prismaService.pointLedgerEntry.findMany({
      where: {
        companyId,
        employeeId,
        pointType,
        entryKind: "AWARD",
        workDate: { gte: startDate, lte: endDate },
        reversalEntries: { none: {} },
        ...(excludeSourceTypes.length ? { sourceType: { notIn: excludeSourceTypes } } : {}),
      },
      select: { id: true, quantity: true, valuePerPointPiasters: true },
    });
    if (penalties.length === 0) return new Prisma.Decimal(0);

    const allocations = await this.prismaService.pointOffsetAllocation.findMany({
      where: { companyId, penaltyEntryId: { in: penalties.map((p) => p.id) } },
      select: { penaltyEntryId: true, quantity: true, reversesAllocationId: true },
    });

    const offset = new Map<string, number>();
    for (const a of allocations) {
      const signed = a.reversesAllocationId ? -a.quantity : a.quantity;
      offset.set(a.penaltyEntryId, (offset.get(a.penaltyEntryId) ?? 0) + signed);
    }

    let total = new Prisma.Decimal(0);
    for (const p of penalties) {
      const remaining = Math.max(0, p.quantity - (offset.get(p.id) ?? 0));
      const pounds = new Prisma.Decimal(p.valuePerPointPiasters.toString()).div(100);
      total = total.add(pounds.mul(remaining));
    }
    return total.toDecimalPlaces(2);
  }

  // -------------------------------------------------------------------- helpers

  /** Single source of truth for the period: explicit range, else previous month. */
  private resolveRange(companyId: string, range?: DateRange): Promise<DateRange> | DateRange {
    return range ?? this.companyPolicy.getPreviousMonthRange(companyId);
  }

  private getSalaryVersions(companyId: string, employeeId: string, startDate: Date, endDate: Date) {
    return this.prismaService.employeeSalaryVersion.findMany({
      where: {
        companyId,
        employeeId,
        effectiveFrom: { lte: endDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: startDate } }],
      },
      orderBy: { effectiveFrom: "asc" },
    });
  }

  private pickVersion<T extends Versioned>(versions: T[], date: Date): T | undefined {
    return versions.find(
      (v) => v.effectiveFrom <= date && (!v.effectiveTo || v.effectiveTo >= date),
    );
  }
}