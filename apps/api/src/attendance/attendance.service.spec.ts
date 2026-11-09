import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PointType, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CompanyPolicyService } from '../company/company-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from './attendance.service';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';

describe('AttendanceService.correct (TEST-012, TEST-013)', () => {
  const companyId = 'c0ffee00-0000-4000-8000-000000000001';
  const adminUserId = 'c0ffee00-0000-4000-8000-000000000002';
  const employeeId = 'c0ffee00-0000-4000-8000-000000000003';
  const dayId = 'c0ffee00-0000-4000-8000-000000000004';
  const workDate = '2026-11-02';

  // Cairo winter (UTC+2): 08:00 local = 06:00Z, absence threshold 12:00 local = 10:00Z, end 16:00 local = 14:00Z.
  const windows = {
    scheduledStartAt: new Date('2026-11-02T06:00:00.000Z'),
    earlyEndAt: new Date('2026-11-02T07:00:00.000Z'),
    graceEndAt: new Date('2026-11-02T08:00:00.000Z'),
    redPeriodEndAt: new Date('2026-11-02T10:00:00.000Z'),
    scheduledEndAt: new Date('2026-11-02T14:00:00.000Z'),
  };
  const existingDay = {
    id: dayId,
    companyId,
    employeeId,
    workDate: new Date(`${workDate}T00:00:00.000Z`),
    timezone: 'Africa/Cairo',
    ...windows,
    checkInAt: null as Date | null,
    checkOutAt: null as Date | null,
    checkInResult: 'SCHEDULED',
    classification: null as PointType | null,
  };

  function createDb(opts: { day?: typeof existingDay | null; activeEntries?: unknown[]; awards?: number } = {}) {
    const db: Record<string, any> = {
      employee: { findFirst: jest.fn().mockResolvedValue({ id: employeeId }) },
      attendanceDay: {
        findUnique: jest.fn().mockResolvedValue(opts.day === undefined ? existingDay : opts.day),
        create: jest.fn().mockImplementation(({ data }) => ({ ...existingDay, ...data, id: dayId })),
        update: jest.fn().mockImplementation(({ data }) => ({ ...existingDay, ...data })),
      },
      shiftAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'assignment-1', shiftId: 'shift-1' }),
      },
      shiftVersion: {
        findFirst: jest.fn().mockResolvedValue({
          startTime: new Date('1970-01-01T08:00:00.000Z'),
          endTime: new Date('1970-01-01T16:00:00.000Z'),
          earlyMinutes: 60,
          graceMinutes: 120,
          redPeriodMinutes: 240,
          weekdays: [{ weekday: 1 }], // 2026-11-02 is a Monday
        }),
      },
      pointLedgerEntry: {
        findMany: jest.fn().mockResolvedValue(opts.activeEntries ?? []),
        count: jest.fn().mockResolvedValue(opts.awards ?? 0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: `entry-${data.idempotencyKey}`, ...data })),
      },
      pointValueVersion: {
        findFirst: jest.fn().mockImplementation(({ where }) => ({
          id: `value-${where.pointType}`,
          value: new Prisma.Decimal(where.pointType === PointType.GREEN ? '1000' : '250'),
        })),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn(async (operation: (tx: unknown) => unknown) => operation(db));
    return db;
  }

  function createService(db: Record<string, any>) {
    const companyPolicy = { getTimezone: jest.fn().mockResolvedValue('Africa/Cairo') };
    return new AttendanceService(
      db as unknown as PrismaService,
      companyPolicy as unknown as CompanyPolicyService,
      new AuditService(db as unknown as PrismaService),
    );
  }

  const dto = (over: Partial<CorrectAttendanceDto>): CorrectAttendanceDto => ({
    employeeId,
    workDate,
    action: 'SET_CHECK_IN',
    at: '2026-11-02T06:30:00.000Z',
    reason: 'Forgot to scan the QR',
    ...over,
  });
  const created = (db: Record<string, any>) =>
    db.pointLedgerEntry.create.mock.calls.map(([arg]: [{ data: any }]) => arg.data);

  it('creates the missing day from the shift snapshot and awards one GREEN (manual check-in)', async () => {
    const db = createDb({ day: null });
    await createService(db).correct(companyId, adminUserId, dto({}));

    expect(db.attendanceDay.create.mock.calls[0][0].data).toMatchObject({
      companyId,
      employeeId,
      shiftAssignmentId: 'assignment-1',
      timezone: 'Africa/Cairo',
      ...windows,
    });
    const [award] = created(db);
    expect(award).toMatchObject({
      pointType: PointType.GREEN,
      entryKind: 'AWARD',
      direction: 1,
      quantity: 1,
      sourceType: 'ATTENDANCE',
      sourceId: dayId,
      idempotencyKey: `ATT:${dayId}:1`,
      valuePerPointPiasters: 100000n,
      reason: 'Forgot to scan the QR',
    });
    expect(db.attendanceDay.update.mock.calls[0][0].data).toMatchObject({
      checkInAt: new Date('2026-11-02T06:30:00.000Z'),
      classification: PointType.GREEN,
    });
  });

  it('reverses the current point with a compensating entry before awarding the new one', async () => {
    const original = {
      id: 'att-1',
      companyId,
      employeeId,
      pointType: PointType.BLACK,
      quantity: 1,
      pointValueVersionId: 'value-BLACK',
      valuePerPointPiasters: 100000n,
      sourceType: 'ATTENDANCE',
    };
    const db = createDb({ day: { ...existingDay, classification: PointType.BLACK }, activeEntries: [original], awards: 1 });
    await createService(db).correct(companyId, adminUserId, dto({ at: '2026-11-02T08:30:00.000Z' }));

    const [reversal, award] = created(db);
    expect(reversal).toMatchObject({
      entryKind: 'REVERSAL',
      direction: -1,
      pointType: PointType.BLACK,
      reversesEntryId: 'att-1',
      sourceType: 'ATTENDANCE',
      sourceId: dayId,
      reason: 'Forgot to scan the QR',
    });
    expect(award).toMatchObject({ pointType: PointType.RED, idempotencyKey: `ATT:${dayId}:2` });
    expect(db.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        actorUserId: adminUserId,
        action: 'attendance.correct',
        targetType: 'attendance_day',
        targetId: dayId,
        reason: 'Forgot to scan the QR',
        changes: expect.objectContaining({
          before: expect.objectContaining({ classification: PointType.BLACK }),
          after: expect.objectContaining({ classification: PointType.RED }),
        }),
      }),
    });
  });

  it('classifies a check-in at the absence threshold as BLACK', async () => {
    const db = createDb();
    await createService(db).correct(companyId, adminUserId, dto({ at: '2026-11-02T10:00:00.000Z' }));
    expect(created(db)[0].pointType).toBe(PointType.BLACK);
  });

  it('awards overtime Greens on check-out after shift end', async () => {
    const db = createDb({
      day: { ...existingDay, checkInAt: new Date('2026-11-02T06:10:00.000Z'), classification: PointType.GREEN },
      awards: 1,
    });
    await createService(db).correct(
      companyId,
      adminUserId,
      dto({ action: 'SET_CHECK_OUT', at: '2026-11-02T16:01:00.000Z' }),
    );
    const entries = created(db);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceType: 'ATTENDANCE', pointType: PointType.GREEN, quantity: 1 }),
        expect.objectContaining({ sourceType: 'OVERTIME', pointType: PointType.GREEN, quantity: 2, idempotencyKey: `OT:${dayId}:2` }),
      ]),
    );
    expect(db.attendanceDay.update.mock.calls[0][0].data).toMatchObject({ overtimeGreens: 2, leftEarly: false });
  });

  it('stores left_early when the corrected check-out is before the shift end (DN-08)', async () => {
    const db = createDb({
      day: { ...existingDay, checkInAt: new Date('2026-11-02T06:10:00.000Z'), classification: PointType.GREEN },
      awards: 1,
    });
    await createService(db).correct(companyId, adminUserId, dto({ action: 'SET_CHECK_OUT', at: '2026-11-02T12:00:00.000Z' }));
    expect(db.attendanceDay.update.mock.calls[0][0].data).toMatchObject({ overtimeGreens: 0, leftEarly: true });
  });

  it('EXEMPT reverses the day and awards nothing', async () => {
    const original = { id: 'att-1', pointType: PointType.BLACK, quantity: 1, valuePerPointPiasters: 100000n, sourceType: 'ATTENDANCE' };
    const db = createDb({ day: { ...existingDay, classification: PointType.BLACK }, activeEntries: [original], awards: 1 });
    await createService(db).correct(companyId, adminUserId, dto({ action: 'EXEMPT', at: undefined }));

    const entries = created(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].entryKind).toBe('REVERSAL');
    expect(db.attendanceDay.update.mock.calls[0][0].data).toMatchObject({
      classification: null,
      checkInResult: 'EXEMPT',
      overtimeGreens: 0,
      leftEarly: false,
    });
  });

  it('rejects a check-out without a check-in, and a check-in before the shift opens', async () => {
    await expect(
      createService(createDb()).correct(companyId, adminUserId, dto({ action: 'SET_CHECK_OUT', at: '2026-11-02T15:00:00.000Z' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      createService(createDb()).correct(companyId, adminUserId, dto({ at: '2026-11-02T05:00:00.000Z' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a day that is not a working day for the employee', async () => {
    const db = createDb({ day: null });
    db.shiftVersion.findFirst.mockResolvedValue({ weekdays: [{ weekday: 5 }] });
    await expect(createService(db).correct(companyId, adminUserId, dto({}))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers 404 for an employee of another company', async () => {
    const db = createDb();
    db.employee.findFirst.mockResolvedValue(null);
    await expect(createService(db).correct(companyId, adminUserId, dto({}))).rejects.toBeInstanceOf(NotFoundException);
    expect(db.employee.findFirst.mock.calls[0][0].where).toEqual({ id: employeeId, companyId });
  });

  it('turns a concurrent correction (unique key clash) into 409', async () => {
    const db = createDb();
    db.pointLedgerEntry.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(createService(db).correct(companyId, adminUserId, dto({}))).rejects.toBeInstanceOf(ConflictException);
  });
});
