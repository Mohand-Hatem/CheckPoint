import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CompanyPolicyService } from '../company/company-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from './employees.service';

describe('EmployeesService (TEST-003)', () => {
  const companyId = 'c0ffee00-0000-4000-8000-000000000001';
  const adminUserId = 'c0ffee00-0000-4000-8000-000000000002';
  const employeeId = 'c0ffee00-0000-4000-8000-000000000003';
  const employeeUserId = 'c0ffee00-0000-4000-8000-000000000004';
  const today = new Date('2026-11-02T00:00:00.000Z');

  // One mock serves as both the client and the transaction client.
  function createService(db: Record<string, any>) {
    db.$transaction = jest.fn(async (operation: (tx: unknown) => unknown) => operation(db));
    db.auditEvent = db.auditEvent ?? { create: jest.fn().mockResolvedValue({}) };
    const companyPolicy = { getCompanyDate: jest.fn().mockResolvedValue(today) };
    return new EmployeesService(
      db as unknown as PrismaService,
      companyPolicy as unknown as CompanyPolicyService,
      new AuditService(db as unknown as PrismaService),
    );
  }

  it('findOne answers 404 for an employee of another company (AC-REQ-033-03)', async () => {
    const db = { employee: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(createService(db).findOne(companyId, employeeId)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.employee.findFirst.mock.calls[0][0].where).toMatchObject({ id: employeeId, companyId });
  });

  it('update trims fields and audits before/after', async () => {
    const db: Record<string, any> = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: employeeId, employeeNumber: 'EMP-010', fullName: 'Sara Ali', phone: null }),
        update: jest.fn().mockResolvedValue({ id: employeeId, employeeNumber: 'EMP-011' }),
      },
    };
    await createService(db).update(companyId, adminUserId, employeeId, { employeeNumber: ' EMP-011 ' });

    expect(db.employee.update.mock.calls[0][0].data).toMatchObject({ employeeNumber: 'EMP-011' });
    expect(db.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId, actorUserId: adminUserId, action: 'employee.update', targetType: 'employee' }),
    });
  });

  describe('setActive (AC-REQ-007-02, AC-REQ-007-05)', () => {
    function activeEmployeeDb() {
      return {
        employee: {
          findFirst: jest.fn().mockResolvedValue({ id: employeeId, userId: employeeUserId }),
          update: jest.fn().mockResolvedValue({ id: employeeId, isActive: false }),
        },
        user: { update: jest.fn().mockResolvedValue({}) },
        refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      } as Record<string, any>;
    }

    it('deactivation revokes sessions, keeps history and audits', async () => {
      const db = activeEmployeeDb();
      await createService(db).setActive(companyId, adminUserId, employeeId, false);

      expect(db.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: employeeUserId, revokedAt: null } }),
      );
      expect(db.user.update).toHaveBeenCalledWith({ where: { id: employeeUserId }, data: { isActive: false } });
      expect(db.employee.update.mock.calls[0][0].data).toMatchObject({ isActive: false });
      expect(db.auditEvent.create).toHaveBeenCalled();
    });

    it('reactivation restarts the absence window on the company date', async () => {
      const db = activeEmployeeDb();
      await createService(db).setActive(companyId, adminUserId, employeeId, true);
      expect(db.employee.update.mock.calls[0][0].data).toEqual({ isActive: true, deactivatedAt: null, activeFrom: today });
      expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to let an Admin deactivate their own account', async () => {
      const db = activeEmployeeDb();
      db.employee.findFirst.mockResolvedValue({ id: employeeId, userId: adminUserId });
      await expect(createService(db).setActive(companyId, adminUserId, employeeId, false)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });
});
