import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// Index = JavaScript getUTCDay(): 0 is Sunday.
export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const WEEKLY_OFF_KEY = 'weekly_off_days';
const DEFAULT_OFF_DAYS: Weekday[] = ['FRI', 'SAT']; // docs/08 §3.8 provisioning default

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** FR-CAL-1. `date` is a company-local date at UTC midnight (as from CompanyPolicyService.getCompanyDate). */
  async isWorkingDay(companyId: string, date: Date): Promise<boolean> {
    const offDays = await this.getWeeklyOffDays(companyId);
    if (offDays.includes(WEEKDAYS[date.getUTCDay()])) return false;
    const holiday = await this.prisma.holiday.findFirst({
      where: { companyId, holidayDate: date },
      select: { id: true },
    });
    return !holiday;
  }

  async getWeeklyOffDays(companyId: string): Promise<Weekday[]> {
    const setting = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: WEEKLY_OFF_KEY } },
      select: { value: true },
    });
    const value = setting?.value;
    return Array.isArray(value) && value.every((day) => WEEKDAYS.includes(day as Weekday))
      ? (value as Weekday[])
      : DEFAULT_OFF_DAYS;
  }

  async setWeeklyOffDays(companyId: string, adminUserId: string, days: Weekday[]): Promise<Weekday[]> {
    const after = WEEKDAYS.filter((day) => days.includes(day));
    if (after.length === WEEKDAYS.length) {
      throw new BadRequestException('At least one day of the week must stay a working day');
    }
    const before = await this.getWeeklyOffDays(companyId);

    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { companyId_key: { companyId, key: WEEKLY_OFF_KEY } },
        update: { value: after, updatedByUserId: adminUserId },
        create: { companyId, key: WEEKLY_OFF_KEY, value: after, updatedByUserId: adminUserId },
      });
      await this.audit.record(tx, {
        companyId,
        actorUserId: adminUserId,
        actorType: 'ADMIN',
        action: 'settings.weekly_off_days.update',
        targetType: 'setting',
        targetId: null,
        changes: { before, after },
      });
    });
    return after;
  }

  async listHolidays(companyId: string, year?: number) {
    const holidays = await this.prisma.holiday.findMany({
      where: {
        companyId,
        ...(year !== undefined && {
          holidayDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
        }),
      },
      orderBy: { holidayDate: 'asc' },
      select: { id: true, holidayDate: true, name: true },
    });
    return holidays.map((holiday) => this.toResponse(holiday));
  }

  async createHoliday(companyId: string, adminUserId: string, date: string, rawName: string) {
    const holidayDate = parseDate(date);
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Holiday name is required');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const holiday = await tx.holiday.create({
          data: { companyId, holidayDate, name, createdByUserId: adminUserId },
        });
        await this.audit.record(tx, {
          companyId,
          actorUserId: adminUserId,
          actorType: 'ADMIN',
          action: 'holiday.create',
          targetType: 'holiday',
          targetId: holiday.id,
          changes: { date, name },
        });
        return this.toResponse(holiday);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`There is already a holiday on ${date}`);
      }
      throw error;
    }
  }

  async deleteHoliday(companyId: string, adminUserId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const holiday = await tx.holiday.findFirst({
        where: { id, companyId },
        select: { id: true, holidayDate: true, name: true },
      });
      if (!holiday) throw new NotFoundException('Holiday not found');

      await tx.holiday.delete({ where: { id } });
      await this.audit.record(tx, {
        companyId,
        actorUserId: adminUserId,
        actorType: 'ADMIN',
        action: 'holiday.delete',
        targetType: 'holiday',
        targetId: id,
        changes: { date: isoDate(holiday.holidayDate), name: holiday.name },
      });
      return this.toResponse(holiday);
    });
  }

  private toResponse(holiday: { id: string; holidayDate: Date; name: string }) {
    return { id: holiday.id, date: isoDate(holiday.holidayDate), name: holiday.name };
  }
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || isoDate(date) !== value) {
    throw new BadRequestException('date must be a real calendar date (YYYY-MM-DD)');
  }
  return date;
}
