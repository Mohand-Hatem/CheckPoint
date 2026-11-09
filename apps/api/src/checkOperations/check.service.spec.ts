import { ForbiddenException } from '@nestjs/common';
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

describe('CheckService.checkIn', () => {
  let service: CheckService;
  let validation: { assertCanCheckIn: jest.Mock };
  let attendanceDay: { recordAttendanceDay: jest.Mock };
  let companyPolicy: {
    getTimezone: jest.Mock;
    getCompanyDate: jest.Mock;
  };
  let employees: { findOne: jest.Mock };
  let locations: { isInAllowedLocation: jest.Mock };
  let points: { addPointEntryForSource: jest.Mock };
  let workOffers: { listForEmployee: jest.Mock };
  let audit: { record: jest.Mock };
  let prisma: { $transaction: jest.Mock };
  let transaction: Prisma.TransactionClient;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(fixedTime));

    transaction = {} as Prisma.TransactionClient;
    validation = { assertCanCheckIn: jest.fn() };
    attendanceDay = {
      recordAttendanceDay: jest.fn().mockResolvedValue({
        id: 'attendance-1',
        checkInAt: new Date(fixedTime),
      }),
    };
    companyPolicy = {
      getTimezone: jest.fn().mockResolvedValue('UTC'),
      getCompanyDate: jest.fn().mockResolvedValue(workDate),
    };
    employees = {
      findOne: jest.fn().mockResolvedValue({
        id: employeeId,
        isActive: true,
        user: { id: userId, isActive: true },
        currentShift: {
          id: 'shift-1',
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

    const result = await service.checkIn(companyId, employeeId, {
      latitude: 30,
      longitude: 31,
    });

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
    expect(result.pointEntry).toEqual(
      expect.objectContaining({ id: 'point-1' }),
    );
  });

  it('records NOT_OPEN without a point when no offer is visible', async () => {
    jest.setSystemTime(new Date('2025-03-10T08:30:00.000Z'));

    const result = await service.checkIn(companyId, employeeId, {
      latitude: 30,
      longitude: 31,
    });

    expect(workOffers.listForEmployee).toHaveBeenCalledWith(companyId, userId);
    expect(attendanceDay.recordAttendanceDay).toHaveBeenCalledWith(
      expect.objectContaining({
        checkInResult: 'NOT_OPEN',
        classification: null,
      }),
      transaction,
    );
    expect(points.addPointEntryForSource).not.toHaveBeenCalled();
    expect(result.pointEntry).toBeNull();
  });

  it('preserves the early-offer GREEN calculation for NOT_OPEN check-ins', async () => {
    jest.setSystemTime(new Date('2025-03-10T08:00:00.000Z'));
    workOffers.listForEmployee.mockResolvedValue([
      { startsAt: new Date('2025-03-10T07:00:00.000Z') },
    ]);

    await service.checkIn(companyId, employeeId, {
      latitude: 30,
      longitude: 31,
    });

    expect(points.addPointEntryForSource).toHaveBeenCalledWith(
      expect.objectContaining({
        pointType: PointType.GREEN,
        quantity: 1,
        reason: expect.stringContaining('checked in early'),
      }),
      transaction,
    );
  });

  it('does not award early points when the offer does not cover the early interval', async () => {
    jest.setSystemTime(new Date('2025-03-10T08:00:00.000Z'));
    workOffers.listForEmployee.mockResolvedValue([
      { startsAt: new Date('2025-03-10T08:30:00.000Z') },
    ]);

    await service.checkIn(companyId, employeeId, {
      latitude: 30,
      longitude: 31,
    });

    expect(points.addPointEntryForSource).not.toHaveBeenCalled();
  });

  it('propagates duplicate check-in validation errors', async () => {
    const error = new Error('Already checked in');
    validation.assertCanCheckIn.mockRejectedValue(error);

    await expect(
      service.checkIn(companyId, employeeId, {
        latitude: 30,
        longitude: 31,
      }),
    ).rejects.toBe(error);
    expect(locations.isInAllowedLocation).not.toHaveBeenCalled();
  });

  it('propagates location authorization errors without recording attendance', async () => {
    const error = new ForbiddenException('Outside allowed location');
    locations.isInAllowedLocation.mockRejectedValue(error);

    await expect(
      service.checkIn(companyId, employeeId, {
        latitude: 30,
        longitude: 31,
      }),
    ).rejects.toBe(error);
    expect(attendanceDay.recordAttendanceDay).not.toHaveBeenCalled();
  });
});
