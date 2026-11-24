import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { CompanyPolicyService } from 'src/company/company-policy.service';
import { SalaryCalculationService } from './salaryCalculation.service';

const BATCH_SIZE = 5; // each employee runs 6 queries in parallel, keep this small

@Injectable()
export class SalaryCronService {
  private readonly logger = new Logger(SalaryCronService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyPolicy: CompanyPolicyService,
    private readonly salaryCalc: SalaryCalculationService,
  ) {}

  // 02:00 on the 1st of every month, Cairo time
  @Cron('0 2 1 * *', { name: 'monthly-salary', timeZone: 'Africa/Cairo' })
  async runMonthly() {
    if (this.running) {
      this.logger.warn('Previous salary run still in progress, skipping.');
      return;
    }
    this.running = true;
    try {
      const companies = await this.prisma.company.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      for (const { id } of companies) {
        try {
          await this.runForCompany(id);
        } catch (error) {
          // one company failing must not stop the others
          this.logger.error(
            `Salary run failed for company ${id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Also callable manually (admin endpoint / retry). Defaults to the previous month. */
  async runForCompany(
    companyId: string,
    range?: { startDate: Date; endDate: Date },
  ) {
    // Resolve the period once so every employee uses identical dates
    const period =
      range ?? (await this.companyPolicy.getPreviousMonthRange(companyId));
    const month = period.startDate;

    const locked = await this.prisma.payrollMonth.findUnique({
      where: { companyId_month: { companyId, month } },
      select: { status: true },
    });
    if (locked?.status === 'LOCKED') {
      this.logger.log(`Company ${companyId}: month is LOCKED, skipping.`);
      return { calculated: 0, failed: 0, skipped: true };
    }

    // Employees who were employed at any point during the period
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        activeFrom: { lte: period.endDate },
        OR: [{ deactivatedAt: null }, { deactivatedAt: { gte: period.startDate } }],
      },
      select: { id: true, employeeNumber: true },
      orderBy: { employeeNumber: 'asc' },
    });

    let calculated = 0;
    let failed = 0;

    for (let i = 0; i < employees.length; i += BATCH_SIZE) {
      const batch = employees.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map((e) => this.calculateAndSave(companyId, e.id, period, month)),
      );

      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          calculated++;
        } else {
          failed++;
          this.logger.error(
            `Employee ${batch[idx].employeeNumber} (${batch[idx].id}) failed: ${
              r.reason instanceof Error ? r.reason.message : r.reason
            }`,
          );
        }
      });
    }

    this.logger.log(
      `Company ${companyId}: ${calculated} calculated, ${failed} failed (${month.toISOString().slice(0, 7)})`,
    );
    return { calculated, failed, skipped: false };
  }

  private async calculateAndSave(
    companyId: string,
    employeeId: string,
    period: { startDate: Date; endDate: Date },
    month: Date,
  ) {
    const s = await this.salaryCalc.calculateSalary(companyId, employeeId, period);

    const data = {
      baseSalary: s.baseSalary,
      leaveDeduction: s.leaveDeduction,
      appliedRedDeduction: s.appliedRedDeduction,
      appliedBlackDeduction: s.appliedBlackDeduction,
      offDayPay: s.offDayPay,
      fundCredit: s.fundCredit,
      netSalary: s.netSalary,
      calculatedAt: new Date(),
    };

    await this.prisma.employeeSalaryRecord.upsert({
      where: {
        companyId_employeeId_month: { companyId, employeeId, month },
      },
      create: { companyId, employeeId, month, ...data },
      update: data,
    });
  }
}