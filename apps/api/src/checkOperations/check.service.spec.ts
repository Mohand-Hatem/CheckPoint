import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PointType, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AttendanceDayService } from '../attendance/attendance-day.service';
import { AttendanceValidationService } from '../attendance/attendance-validation.service';
import { CompanyPolicyService } from '../company/company-policy.service';
import { EmployeesService } from '../employees/employees.service';
import { LocationService } from '../location/location.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkOffersService } from '../work-offers/work-offers.service';
import { CheckService } from './check.service';

const companyId = 'company-1';
const employeeId = 'employee-1';
const userId = 'user-1';
const workDate = new Date('2025-03-10T00:00:00.000Z');
const fixedTime = '2025-03-10T09:30:00.000Z';
const POSITION = { lat: 30, lng: 31, accuracy: 10 };

describe('CheckService.checkIn', () => {
  let service: CheckService;
  let validation: { assertCanCheckIn: jest.Mock; assertCanCheckOut: jest.Mock };
  let attendanceDay: { recordAttendanceDay: jest.Mock };
  let companyPolicy: {
    getTimezone: jest.Mock;
    getCompanyDate: jest.Mock;
    getGpsMaxAccuracyM: jest.Mock;
  };
  let updateMany: jest.Mock;
  let employees: { findOne: jest.Mock };
  let locations: { isInAllowedLocation: jest.Mock };
  let points: { addPointEntryForSource: jest.Mock };
  let workOffers: { listForEmployee: jest.Mock };
  let audit: { record: jest.Mock };
  let prisma: { $transaction: jest.Mock; employee?: { findFirst: jest.Mock } };
  let transaction: Prisma.TransactionClient;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(fixedTime));

    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    transaction = { attendanceDay: { updateMany } } as unknown as Prisma.TransactionClient;
    validation = {
      assertCanCheckIn: jest.fn(),
      assertCanCheckOut: jest.fn().mockResolvedValue({
        id: 'attendance-1',
        checkInAt: new Date('2025-03-10T09:10:00.000Z'),
        checkOutAt: null,
        scheduledEndAt: new Date('2025-03-10T16:00:00.000Z'),
      }),
    };
    attendanceDay = {
      recordAttendanceDay: jest.fn().mockResolvedValue({
        id: 'attendance-1',
        checkInAt: new Date(fixedTime),
      }),
    };
    companyPolicy = {
      getTimezone: jest.fn().mockResolvedValue('UTC'),
      getCompanyDate: jest.fn().mockResolvedValue(workDate),
      getGpsMaxAccuracyM: jest.fn().mockResolvedValue(50),
    };
    employees = {
      findOne: jest.fn().mockResolvedValue({
        id: employeeId,
        isActive: true,
        user: { id: userId, isActive: true },
        currentShift: {
          id: 'shift-1',
          isActive: true,
          versions: [
            {
              startTime: new Date('1970-01-01T09:00:00.000Z'),
              endTime: new Date('1970-01-01T17:00:00.000Z'),
              earlyMinutes: 60,
              graceMinutes: 120,
              redPeriodMinutes: 180,
              effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
              effectiveTo: null,
            },
          ],
        },
        shiftAssignments: [
          {
            id: 'assignment-1',
            shiftId: 'shift-1',
            effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
            effectiveTo: null,
          },
        ],
      }),
    };
    locations = {
      isInAllowedLocation: jest.fn().mockResolvedValue({
        allowed: true,
        locationId: 'location-1',
        distanceM: 10,
      }),
    };
    points = {
      addPointEntryForSource: jest.fn().mockResolvedValue({
        id: 'point-1',
        pointType: PointType.GREEN,
      }),
    };
    workOffers = { listForEmployee: jest.fn().mockResolvedValue([]) };
    audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    prisma = {
      $transaction: jest.fn(
        (callback: (tx: Prisma.TransactionClient) => unknown) =>
          callback(transaction),
      ),
    };

    service = new CheckService(
      validation as unknown as AttendanceValidationService,
      attendanceDay as unknown as AttendanceDayService,
      companyPolicy as unknown as CompanyPolicyService,
      employees as unknown as EmployeesService,
      locations as unknown as LocationService,
      points as unknown as PointsService,
      workOffers as unknown as WorkOffersService,
      audit as unknown as AuditService,
      prisma as unknown as PrismaService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['GREEN', '2025-03-10T09:30:00.000Z', PointType.GREEN],
    ['WHITE', '2025-03-10T10:30:00.000Z', PointType.WHITE],
    ['RED', '2025-03-10T11:30:00.000Z', PointType.RED],
    ['BLACK', '2025-03-10T12:30:00.000Z', PointType.BLACK],
  ])('records a %s check-in and awards that point', async (_name, time, type) => {
    jest.setSystemTime(new Date(time));

    const result = await service.checkIn(companyId, employeeId, POSITION);

    expect(attendanceDay.recordAttendanceDay).toHaveBeenCalledWith(
      expect.objectContaining({
        checkInResult: type,
        classification: type,
        checkInAt: new Date(time),
      }),
      transaction,
    );
    expect(points.addPointEntryForSource).toHaveBeenCalledWith(
      expect.objectContaining({
        pointType: type,
        quantity: 1,
        sourceType: 'ATTENDANCE',
        sourceId: 'attendance-1',
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        actorUserId: userId,
        actorType: 'EMPLOYEE',
        targetId: 'attendance-1',
      }),
    );
    expect(points.addPointEntryForSource).toHaveBeenCalledTimes(1);
    expect(result.pointEntries).toEqual([
      expect.objectContaining({ id: 'point-1' }),
    ]);
  });

  const earlyOffer = (overrides: Record<string, unknown> = {}) => ({
    offerType: 'EARLY_WORK',
    status: 'ACTIVE',
    startsAt: new Date('2025-03-10T06:00:00.000Z'),
    endsAt: new Date('2025-03-10T09:00:00.000Z'),
    ...overrides,
  });

  async function expectNotOpen() {
    await expect(
      service.checkIn(companyId, employeeId, POSITION),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'CHECKIN_NOT_OPEN' }),
    });
    expect(attendanceDay.recordAttendanceDay).not.toHaveBeenCalled();
    expect(points.addPointEntryForSource).not.toHaveBeenCalled();
  }

  it('rejects a check-in before the shift opens when no offer is visible (DN-04)', async () => {
    jest.setSystemTime(new Date('2025-03-10T08:30:00.000Z'));
    await expectNotOpen();
    expect(workOffers.listForEmployee).toHaveBeenCalledWith(companyId, userId);
  });

  it.each([
    ['a cancelled offer', { status: 'CANCELLED' }],
    ['a completed offer', { status: 'COMPLETED' }],
    ['an OVERTIME offer', { offerType: 'OVERTIME' }],
    ['an offer that starts after the check-in', { startsAt: new Date('2025-03-10T08:30:00.000Z') }],
    ['an offer that ended before the check-in', { endsAt: new Date('2025-03-10T07:30:00.000Z') }],
  ])('rejects an early check-in covered only by %s', async (_name, overrides) => {
    jest.setSystemTime(new Date('2025-03-10T08:00:00.000Z'));
    workOffers.listForEmployee.mockResolvedValue([earlyOffer(overrides)]);
    await expectNotOpen();
  });

  it('accepts an early check-in covered by an active EARLY_WORK offer: day GREEN plus one GREEN per full early hour', async () => {
    jest.setSystemTime(new Date('2025-03-10T06:50:00.000Z'));
    workOffers.listForEmployee.mockResolvedValue([
      earlyOffer({ status: 'CANCELLED' }),
      earlyOffer(),
    ]);

    const result = await service.checkIn(companyId, employeeId, POSITION);

    expect(attendanceDay.recordAttendanceDay).toHaveBeenCalledWith(
      expect.objectContaining({ checkInResult: 'GREEN', classification: PointType.GREEN }),
      transaction,
    );
    expect(points.addPointEntryForSource).toHaveBeenCalledTimes(2);
    expect(points.addPointEntryForSource).toHaveBeenCalledWith(
      expect.objectContaining({ pointType: PointType.GREEN, quantity: 1, idempotencyKey: 'ATT:employee-1:2025-03-10' }),
      transaction,
    );
    expect(points.addPointEntryForSource).toHaveBeenCalledWith(
      expect.objectContaining({
        pointType: PointType.GREEN,
        quantity: 2,
        idempotencyKey: 'ATT_EARLY:employee-1:2025-03-10',
        reason: expect.stringContaining('checked in early'),
      }),
      transaction,
    );
    expect(result.pointEntries).toHaveLength(2);
  });

  it('rejects a check-in when the employee shift is inactive', async () => {
    const employee = await employees.findOne();
    employees.findOne.mockResolvedValue({
      ...employee,
      currentShift: { ...employee.currentShift, isActive: false },
    });

    await expect(
      service.checkIn(companyId, employeeId, POSITION),
    ).rejects.toMatchObject({ status: 400 });
    expect(attendanceDay.recordAttendanceDay).not.toHaveBeenCalled();
  });

  it('checkInAsUser checks in the employee that belongs to the logged-in user', async () => {
    prisma.employee = { findFirst: jest.fn().mockResolvedValue({ id: employeeId }) };

    await service.checkInAsUser(companyId, userId, POSITION);

    expect(prisma.employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId, userId } }),
    );
    expect(employees.findOne).toHaveBeenCalledWith(companyId, employeeId);
    expect(attendanceDay.recordAttendanceDay).toHaveBeenCalled();
  });

  it('checkInAsUser answers 404 when the user has no employee profile', async () => {
    prisma.employee = { findFirst: jest.fn().mockResolvedValue(null) };

    await expect(
      service.checkInAsUser(companyId, userId, POSITION),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(employees.findOne).not.toHaveBeenCalled();
  });

  it('passes the GPS position to the geofence check', async () => {
    await service.checkIn(companyId, employeeId, POSITION);
    expect(locations.isInAllowedLocation).toHaveBeenCalledWith(
      userId,
      companyId,
      'CHECKIN',
      { latitude: 30, longitude: 31 },
    );
  });

  it('rejects a check-in whose GPS accuracy is worse than the company limit', async () => {
    await expect(
      service.checkIn(companyId, employeeId, { ...POSITION, accuracy: 51 }),
    ).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({ code: 'GPS_ACCURACY_TOO_LOW' }),
    });
    expect(locations.isInAllowedLocation).not.toHaveBeenCalled();
    expect(attendanceDay.recordAttendanceDay).not.toHaveBeenCalled();
  });

  it('propagates duplicate check-in validation errors', async () => {
    const error = new Error('Already checked in');
    validation.assertCanCheckIn.mockRejectedValue(error);

    await expect(
      service.checkIn(companyId, employeeId, POSITION),
    ).rejects.toBe(error);
    expect(locations.isInAllowedLocation).not.toHaveBeenCalled();
  });

  it('propagates location authorization errors without recording attendance', async () => {
    const error = new ForbiddenException('Outside allowed location');
    locations.isInAllowedLocation.mockRejectedValue(error);

    await expect(
      service.checkIn(companyId, employeeId, POSITION),
    ).rejects.toBe(error);
    expect(attendanceDay.recordAttendanceDay).not.toHaveBeenCalled();
  });

  describe('checkOut (REQ-014, FR-ATT-5)', () => {
    const checkOut = () => service.checkOut(companyId, employeeId, POSITION);

    it('records a server-time checkout and awards whole-hour overtime GREENs atomically', async () => {
      jest.setSystemTime(new Date('2025-03-10T18:30:00.000Z'));

      await expect(checkOut()).resolves.toEqual({
        checkOutAt: new Date('2025-03-10T18:30:00.000Z'),
        overtimeGreens: 2,
      });

      expect(validation.assertCanCheckOut).toHaveBeenCalledWith(companyId, employeeId, workDate);
      expect(locations.isInAllowedLocation).toHaveBeenCalledWith(
        userId,
        companyId,
        'CHECKOUT',
        { latitude: 30, longitude: 31 },
      );
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'attendance-1', companyId, employeeId, checkOutAt: null },
        data: { checkOutAt: new Date('2025-03-10T18:30:00.000Z') },
      });
      expect(points.addPointEntryForSource).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId,
          employeeId,
          pointType: PointType.GREEN,
          quantity: 2,
          sourceType: 'OVERTIME',
          sourceId: 'attendance-1',
          idempotencyKey: 'OT:attendance-1:checkout',
          asOfDate: workDate,
        }),
        transaction,
      );
      expect(audit.record).toHaveBeenCalledWith(
        transaction,
        expect.objectContaining({
          actorType: 'EMPLOYEE',
          action: 'attendance.check_out',
          targetId: 'attendance-1',
        }),
      );
    });

    it.each([
      ['15:00 (before shift end)', '2025-03-10T15:00:00.000Z', 0],
      ['16:59', '2025-03-10T16:59:00.000Z', 0],
      ['17:00', '2025-03-10T17:00:00.000Z', 1],
      ['17:59', '2025-03-10T17:59:00.000Z', 1],
      ['18:00', '2025-03-10T18:00:00.000Z', 2],
    ])('shift end 16:00, checkout at %s gives %i overtime GREEN', async (_label, time, greens) => {
      jest.setSystemTime(new Date(time));

      await expect(checkOut()).resolves.toEqual({
        checkOutAt: new Date(time),
        overtimeGreens: greens,
      });
      expect(updateMany).toHaveBeenCalled();
      expect(points.addPointEntryForSource).toHaveBeenCalledTimes(greens ? 1 : 0);
    });

    it('answers the validation error (INVALID_STATE / ALREADY_CHECKED_OUT) and writes nothing', async () => {
      const error = new Error('no check-in');
      validation.assertCanCheckOut.mockRejectedValue(error);

      await expect(checkOut()).rejects.toBe(error);
      expect(locations.isInAllowedLocation).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
      expect(points.addPointEntryForSource).not.toHaveBeenCalled();
    });

    it('rejects poor GPS accuracy and writes nothing', async () => {
      await expect(
        service.checkOut(companyId, employeeId, { ...POSITION, accuracy: 80 }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({ code: 'GPS_ACCURACY_TOO_LOW' }),
      });
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('rejects a position outside every assigned location and writes nothing', async () => {
      const error = new ForbiddenException('Outside allowed location');
      locations.isInAllowedLocation.mockRejectedValue(error);

      await expect(checkOut()).rejects.toBe(error);
      expect(updateMany).not.toHaveBeenCalled();
      expect(points.addPointEntryForSource).not.toHaveBeenCalled();
    });

    it('answers 409 ALREADY_CHECKED_OUT when a concurrent request checked out first', async () => {
      jest.setSystemTime(new Date('2025-03-10T18:30:00.000Z'));
      updateMany.mockResolvedValue({ count: 0 });

      await expect(checkOut()).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: 'ALREADY_CHECKED_OUT' }),
      });
      expect(points.addPointEntryForSource).not.toHaveBeenCalled();
    });

    it('fails the whole checkout when the ledger write fails', async () => {
      jest.setSystemTime(new Date('2025-03-10T18:30:00.000Z'));
      const error = new Error('ledger down');
      points.addPointEntryForSource.mockRejectedValue(error);

      await expect(checkOut()).rejects.toBe(error);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('requires an active employee login', async () => {
      const employee = await employees.findOne();
      employees.findOne.mockResolvedValue({ ...employee, user: { id: userId, isActive: false } });

      await expect(checkOut()).rejects.toBeInstanceOf(ForbiddenException);
      expect(validation.assertCanCheckOut).not.toHaveBeenCalled();
    });

    it('checkOutAsUser checks out the employee linked to the login', async () => {
      prisma.employee = { findFirst: jest.fn().mockResolvedValue({ id: employeeId }) };

      await service.checkOutAsUser(companyId, userId, POSITION);

      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId, userId } }),
      );
      expect(validation.assertCanCheckOut).toHaveBeenCalledWith(companyId, employeeId, workDate);
    });
  });
});
