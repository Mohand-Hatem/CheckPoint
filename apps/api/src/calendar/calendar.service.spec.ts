import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from './calendar.service';

describe('CalendarService (FR-CAL-1)', () => {
  const companyId = 'c0ffee00-0000-4000-8000-000000000001';
  const adminId = 'c0ffee00-0000-4000-8000-000000000002';
  const holidayId = 'c0ffee00-0000-4000-8000-000000000003';
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  // 2026-11-13 is a Friday, 2026-11-14 a Saturday, 2026-11-15 a Sunday.

  function setup(offDays: unknown = ['FRI', 'SAT'], holiday: Record<string, unknown> | null = null) {
    const db: Record<string, any> = {
      setting: {
        findUnique: jest.fn().mockResolvedValue(offDays === undefined ? null : { value: offDays }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      holiday: {
        findFirst: jest.fn().mockResolvedValue(holiday),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: holidayId, ...data })),
        delete: jest.fn().mockResolvedValue({}),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn((operation: (tx: unknown) => unknown) => operation(db));
    const service = new CalendarService(db as unknown as PrismaService, new AuditService(db as unknown as PrismaService));
    return { db, service };
  }

  describe('isWorkingDay', () => {
    it('is false on a weekly off day and true otherwise', async () => {
      const { service } = setup();
      await expect(service.isWorkingDay(companyId, day('2026-11-13'))).resolves.toBe(false);
      await expect(service.isWorkingDay(companyId, day('2026-11-14'))).resolves.toBe(false);
      await expect(service.isWorkingDay(companyId, day('2026-11-15'))).resolves.toBe(true);
    });

    it('is false on a holiday that falls on a normal working day', async () => {
      const { service, db } = setup(['FRI', 'SAT'], { id: holidayId });
      await expect(service.isWorkingDay(companyId, day('2026-11-15'))).resolves.toBe(false);
      expect(db.holiday.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId, holidayDate: day('2026-11-15') } }),
      );
    });

    it('uses FRI/SAT when the company has no valid setting', async () => {
      await expect(setup(undefined).service.isWorkingDay(companyId, day('2026-11-13'))).resolves.toBe(false);
      await expect(setup('broken').service.getWeeklyOffDays(companyId)).resolves.toEqual(['FRI', 'SAT']);
    });
  });

  describe('weekly off days', () => {
    it('stores the new days in week order and audits before/after', async () => {
      const { service, db } = setup();

      await expect(service.setWeeklyOffDays(companyId, adminId, ['SAT', 'FRI', 'SAT'])).resolves.toEqual([
        'FRI',
        'SAT',
      ]);
      expect(db.setting.upsert).toHaveBeenCalledWith({
        where: { companyId_key: { companyId, key: 'weekly_off_days' } },
        update: { value: ['FRI', 'SAT'], updatedByUserId: adminId },
        create: { companyId, key: 'weekly_off_days', value: ['FRI', 'SAT'], updatedByUserId: adminId },
      });
      expect(db.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'settings.weekly_off_days.update',
          changes: { before: ['FRI', 'SAT'], after: ['FRI', 'SAT'] },
        }),
      });
    });

    it('refuses every day off (at least one working day must remain)', async () => {
      const { service, db } = setup();
      await expect(
        service.setWeeklyOffDays(companyId, adminId, ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.setting.upsert).not.toHaveBeenCalled();
    });
  });

  describe('holidays', () => {
    it('creates a holiday with a trimmed name and audits it', async () => {
      const { service, db } = setup();

      await expect(service.createHoliday(companyId, adminId, '2026-12-25', '  Christmas ')).resolves.toEqual({
        id: holidayId,
        date: '2026-12-25',
        name: 'Christmas',
      });
      expect(db.holiday.create).toHaveBeenCalledWith({
        data: { companyId, holidayDate: day('2026-12-25'), name: 'Christmas', createdByUserId: adminId },
      });
      expect(db.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'holiday.create', targetId: holidayId }),
      });
    });

    it('rejects an impossible date and a blank name', async () => {
      const { service } = setup();
      await expect(service.createHoliday(companyId, adminId, '2026-02-30', 'X')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.createHoliday(companyId, adminId, '2026-12-25', '  ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('answers 409 when the company already has a holiday on that date', async () => {
      const { service, db } = setup();
      db.holiday.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.createHoliday(companyId, adminId, '2026-12-25', 'Christmas')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('lists a year of holidays in date order', async () => {
      const { service, db } = setup();
      db.holiday.findMany.mockResolvedValue([{ id: holidayId, holidayDate: day('2026-12-25'), name: 'Christmas' }]);

      await expect(service.listHolidays(companyId, 2026)).resolves.toEqual([
        { id: holidayId, date: '2026-12-25', name: 'Christmas' },
      ]);
      expect(db.holiday.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId, holidayDate: { gte: day('2026-01-01'), lt: day('2027-01-01') } },
          orderBy: { holidayDate: 'asc' },
        }),
      );
    });

    it('deletes a holiday of the company, audited; 404 otherwise', async () => {
      const found = setup(['FRI', 'SAT'], { id: holidayId, holidayDate: day('2026-12-25'), name: 'Christmas' });
      await found.service.deleteHoliday(companyId, adminId, holidayId);
      expect(found.db.holiday.delete).toHaveBeenCalledWith({ where: { id: holidayId } });
      expect(found.db.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'holiday.delete', targetId: holidayId }),
      });

      const missing = setup();
      await expect(missing.service.deleteHoliday(companyId, adminId, holidayId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
