import { ConflictException } from '@nestjs/common';
import { MonthStatus, Prisma } from '@prisma/client';

const monthKey = (date: Date) => date.toISOString().slice(0, 7);

/** 409 MONTH_LOCKED before any point write; the insert triggers are the backstop (FR-PTS-4). */
export async function assertMonthOpen(
  tx: Prisma.TransactionClient,
  companyId: string,
  workDate: Date,
) {
  const month = new Date(`${monthKey(workDate)}-01T00:00:00.000Z`);
  const locked = await tx.payrollMonth.findFirst({
    where: { companyId, month, status: MonthStatus.LOCKED },
    select: { month: true },
  });
  if (locked) {
    throw new ConflictException({
      statusCode: 409,
      message: `Payroll month ${monthKey(workDate)} is locked.`,
      error: 'Conflict',
      code: 'MONTH_LOCKED',
    });
  }
}

/** `YYYY-MM` keys of the company's locked months, to keep their points out of offsets. */
export async function lockedMonths(
  tx: Prisma.TransactionClient,
  companyId: string,
) {
  const rows = await tx.payrollMonth.findMany({
    where: { companyId, status: MonthStatus.LOCKED },
    select: { month: true },
  });
  return new Set(rows.map((row) => monthKey(row.month)));
}

export const isInMonths = (months: Set<string>, workDate: Date) =>
  months.has(monthKey(workDate));
