import { Prisma } from '@prisma/client';

// shortcut: one fixed timezone (the MVP is Cairo only, TASK-032); read the company timezone setting once a second one exists
const COMPANY_TIMEZONE = 'Africa/Cairo';

export interface SalaryVersionRow {
  id: string;
  salary: Prisma.Decimal | number;
  effectiveFrom: Date;
  createdAt: Date;
  createdBy: { id: string; email: string } | null;
}

/** Today's calendar date in Cairo, as a UTC-midnight Date so it compares with `@db.Date` columns. */
export function cairoToday(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TIMEZONE }).format(now); // YYYY-MM-DD
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * A version is in force from its effectiveFrom date onward (docs/05 §2.3):
 * current = latest one already started, upcoming = earliest one not yet started.
 */
export function splitSalaryVersions(rows: SalaryVersionRow[], today: Date) {
  const history = rows
    .map((s) => ({
      id: s.id,
      amount: s.salary,
      currency: 'EGP',
      effectiveFrom: s.effectiveFrom,
      createdAt: s.createdAt,
      creator: s.createdBy,
    }))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

  const started = history.filter((s) => s.effectiveFrom <= today);
  const notStarted = history.filter((s) => s.effectiveFrom > today);
  return {
    current: started[0] ?? null,
    upcoming: notStarted[notStarted.length - 1] ?? null,
    history,
  };
}
