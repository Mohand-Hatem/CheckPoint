import 'reflect-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulesService } from '../schedules/schedules.service';
import { EmployeesService } from '../employees/employees.service';
import { CompanyPolicyService } from '../company/company-policy.service';
import { AuditService } from './audit.service';

describe('AuditService (TEST-026)', () => {
  const companyId = 'c0ffee00-0000-4000-8000-000000000001';
  const adminUserId = 'c0ffee00-0000-4000-8000-000000000002';

  it('records actor, action, target, changes and reason inside the given transaction', async () => {
    const tx = { auditEvent: { create: jest.fn().mockResolvedValue({}) } };
    await new AuditService({} as PrismaService).record(tx as any, {
      companyId,
      actorUserId: adminUserId,
      action: 'shift.create',
      targetType: 'SHIFT',
      targetId: 'shift-1',
      changes: { name: 'Morning' },
      reason: 'New branch',
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: {
        companyId,
        actorUserId: adminUserId,
        actorType: 'ADMIN',
        action: 'shift.create',
        targetType: 'SHIFT',
        targetId: 'shift-1',
        changes: { name: 'Morning' },
        reason: 'New branch',
      },
    });
  });

  it('lists only the caller company, newest first, with filters (AC-REQ-028-01)', async () => {
    const prisma = {
      auditEvent: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    await new AuditService(prisma as unknown as PrismaService).list(companyId, {
      targetType: 'ATTENDANCE_DAY',
      from: '2026-11-01',
      to: '2026-11-02',
      page: 2,
      limit: 10,
    });
    const args = prisma.auditEvent.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      companyId,
      targetType: 'ATTENDANCE_DAY',
      createdAt: { gte: new Date('2026-11-01T00:00:00.000Z'), lt: new Date('2026-11-03T00:00:00.000Z') },
    });
    expect(args).toMatchObject({ orderBy: { createdAt: 'desc' }, skip: 10, take: 10 });
  });

  it('schedules mutations are audited: assigning a shift writes an audit row', async () => {
    const tx = { auditEvent: { create: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      shift: { findFirst: jest.fn().mockResolvedValue({ id: 'shift-1' }) },
      $transaction: jest.fn(async (op: (t: unknown) => unknown) => op(tx)),
    };
    const employees = { assignShift: jest.fn().mockResolvedValue({ id: 'assignment-1' }) };
    const companyPolicy = { getCompanyDate: jest.fn().mockResolvedValue(new Date('2026-11-02T00:00:00.000Z')) };
    const service = new SchedulesService(
      prisma as unknown as PrismaService,
      employees as unknown as EmployeesService,
      companyPolicy as unknown as CompanyPolicyService,
      new AuditService(prisma as unknown as PrismaService),
    );

    await service.assignShift(companyId, 'shift-1', adminUserId, {
      employeeId: 'employee-1',
      effectiveFrom: '2026-11-10',
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        actorUserId: adminUserId,
        action: 'shift.assign',
        targetType: 'SHIFT_ASSIGNMENT',
        targetId: 'assignment-1',
      }),
    });
  });
});
