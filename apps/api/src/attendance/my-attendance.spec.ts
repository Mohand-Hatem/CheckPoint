import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CompanyPolicyService } from '../company/company-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from './attendance.service';

describe('AttendanceService.listMine (FR-ATT-7, E8)', () => {
  const companyId = 'company-1';
  const userId = 'user-1';
  const employeeId = 'employee-1';
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  function setup(employee: { id: string } | null = { id: employeeId }) {
    const prisma = {
      employee: { findFirst: jest.fn().mockResolvedValue(employee) },
      attendanceDay: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'day-1',
            workDate: day('2026-11-02'),
            checkInAt: new Date('2026-11-02T06:10:00.000Z'),
            checkOutAt: new Date('2026-11-02T14:05:00.000Z'),
            checkInResult: 'GREEN',
            classification: 'GREEN',
            scheduledStartAt: new Date('2026-11-02T06:00:00.000Z'),
            scheduledEndAt: new Date('2026-11-02T14:00:00.000Z'),
          },
        ]),
      },
    };
    const companyPolicy = { getCompanyDate: jest.fn().mockResolvedValue(day('2026-11-09')) };
    const service = new AttendanceService(
      prisma as unknown as PrismaService,
      companyPolicy as unknown as CompanyPolicyService,
      {} as AuditService,
    );
    return { prisma, companyPolicy, service };
  }

  it("returns only the caller's days of the requested month, by date", async () => {
    const { prisma, service } = setup();

    await expect(service.listMine(companyId, userId, '2026-11')).resolves.toEqual({
      month: '2026-11',
      days: [
        {
          id: 'day-1',
          workDate: '2026-11-02',
          checkInAt: new Date('2026-11-02T06:10:00.000Z'),
          checkOutAt: new Date('2026-11-02T14:05:00.000Z'),
          checkInResult: 'GREEN',
          classification: 'GREEN',
          scheduledStartAt: new Date('2026-11-02T06:00:00.000Z'),
          scheduledEndAt: new Date('2026-11-02T14:00:00.000Z'),
        },
      ],
    });
    expect(prisma.employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId, userId } }),
    );
    expect(prisma.attendanceDay.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId, employeeId, workDate: { gte: day('2026-11-01'), lt: day('2026-12-01') } },
        orderBy: { workDate: 'asc' },
      }),
    );
  });

  it('defaults to the current company-local month and rolls over December', async () => {
    const { prisma, service, companyPolicy } = setup();
    await expect(service.listMine(companyId, userId)).resolves.toMatchObject({ month: '2026-11' });
    expect(companyPolicy.getCompanyDate).toHaveBeenCalledWith(companyId);

    await service.listMine(companyId, userId, '2026-12');
    expect(prisma.attendanceDay.findMany.mock.calls[1][0].where.workDate).toEqual({
      gte: day('2026-12-01'),
      lt: day('2027-01-01'),
    });
  });

  it('rejects a malformed month and answers 404 without an employee profile', async () => {
    await expect(setup().service.listMine(companyId, userId, '2026-13')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup(null).service.listMine(companyId, userId, '2026-11')).rejects.toBeInstanceOf(NotFoundException);
  });
});
