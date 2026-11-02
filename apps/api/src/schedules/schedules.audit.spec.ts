import 'reflect-metadata';
import { AuditService } from '../audit/audit.service';
import { CompanyPolicyService } from '../company/company-policy.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulesService } from './schedules.service';

describe('SchedulesService audit (TEST-026, AC-REQ-028-02)', () => {
  const companyId = 'c0ffee00-0000-4000-8000-000000000001';
  const adminUserId = 'c0ffee00-0000-4000-8000-000000000002';

  it('assigning a shift writes an audit row in the same transaction', async () => {
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

    await service.assignShift(companyId, 'shift-1', adminUserId, { employeeId: 'employee-1', effectiveFrom: '2026-11-10' });

    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        actorUserId: adminUserId,
        actorType: 'ADMIN',
        action: 'shift.assign',
        targetType: 'shift_assignment',
        targetId: 'assignment-1',
      }),
    });
  });
});
