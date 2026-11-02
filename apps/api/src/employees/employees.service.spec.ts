import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MailerService, MailerTestModule, TestMailbox } from '@nestjs-modules/mailer';
import { CompanyInvitationStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CompanyPolicyService } from '../company/company-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from './employees.service';

describe('EmployeesService', () => {
  const companyId = 'c0ffee00-0000-4000-8000-000000000001';
  const adminUserId = 'c0ffee00-0000-4000-8000-000000000002';
  const employeeId = 'c0ffee00-0000-4000-8000-000000000003';
  const employeeUserId = 'c0ffee00-0000-4000-8000-000000000004';
  const shiftId = 'c0ffee00-0000-4000-8000-000000000005';
  const invitationId = 'c0ffee00-0000-4000-8000-000000000006';
  const today = new Date('2026-11-02T00:00:00.000Z');
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

  let mailbox: TestMailbox;
  let mailer: MailerService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MailerTestModule.register({
          defaults: { from: 'CheckPoint <no-reply@checkpoint.test>' },
        }),
      ],
    }).compile();
    mailbox = moduleRef.get(TestMailbox);
    mailer = moduleRef.get(MailerService);
  });

  beforeEach(() => mailbox.clear());

  // One mock serves as both the client and the transaction client.
  function createService(db: Record<string, any>, env: Record<string, string> = {}) {
    db.$transaction = jest.fn(async (operation: (tx: unknown) => unknown) => operation(db));
    db.auditEvent = db.auditEvent ?? { create: jest.fn().mockResolvedValue({}) };
    const companyPolicy = { getCompanyDate: jest.fn().mockResolvedValue(today) };
    const config = new ConfigService({
      SMTP_HOST: 'smtp.checkpoint.test',
      INVITE_URL_BASE: 'https://app.checkpoint.test/invite',
      ...env,
    });
    return new EmployeesService(
      db as unknown as PrismaService,
      companyPolicy as unknown as CompanyPolicyService,
      mailer,
      config,
    );
  }

  function createDb(overrides: Record<string, any> = {}) {
    return {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: adminUserId }),
        findUnique: jest.fn().mockResolvedValue(null),
        ...overrides.user,
      },
      shift: { findFirst: jest.fn().mockResolvedValue({ id: shiftId }) },
      employee: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: employeeId, fullName: 'Sara Ali' }),
        ...overrides.employee,
      },
      shiftAssignment: { create: jest.fn().mockResolvedValue({}) },
      companyInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: invitationId, status: 'PENDING' }),
        ...overrides.companyInvitation,
      },
      ...overrides.extra,
    };
  }

  const createDto = {
    employeeNumber: 'EMP-010',
    fullName: 'Sara Ali',
    email: 'sara@example.com',
    shiftId,
  };

  describe('create (TEST-003, TEST-039)', () => {
    it('rejects an email that already has an account', async () => {
      const db = createDb({ user: { findUnique: jest.fn().mockResolvedValue({ id: 'x' }) } });
      await expect(
        createService(db).create(companyId, adminUserId, createDto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.employee.create).not.toHaveBeenCalled();
    });

    it('rejects an employee number already used in the company', async () => {
      const db = createDb({ employee: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) } });
      await expect(
        createService(db).create(companyId, adminUserId, createDto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.employee.create).not.toHaveBeenCalled();
    });

    it('stores only the token hash, audits, and emails the link after commit (AC-REQ-032-05)', async () => {
      const db = createDb();
      const result = await createService(db).create(companyId, adminUserId, createDto);

      const token = new URL(result.invitationLink).searchParams.get('token')!;
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      const stored = db.companyInvitation.create.mock.calls[0][0].data;
      expect(stored.tokenHash).toBe(sha256(token));
      expect(JSON.stringify(stored)).not.toContain(token);
      expect(db.employee.create.mock.calls[0][0].data).toMatchObject({ companyId, isActive: false });
      expect(db.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId, actorUserId: adminUserId, action: 'employee.invite' }),
        }),
      );

      expect(result.emailSent).toBe(true);
      const mail = mailbox.assertSent({ to: 'sara@example.com' });
      expect(mail.text).toContain(result.invitationLink);
    });

    it('keeps the invitation and reports emailSent=false when sending fails', async () => {
      mailbox.failNext(new Error('SMTP down'));
      const result = await createService(createDb()).create(companyId, adminUserId, createDto);
      expect(result.invitation.id).toBe(invitationId);
      expect(result.emailSent).toBe(false);
    });

    it('reports emailSent=false when SMTP is not configured', async () => {
      const result = await createService(createDb(), { SMTP_HOST: '' }).create(
        companyId,
        adminUserId,
        createDto,
      );
      expect(result.emailSent).toBe(false);
      expect(result.invitationLink).toContain('token=');
    });
  });

  it('findOne answers 404 for an employee of another company (AC-REQ-033-03)', async () => {
    const db = createDb();
    await expect(createService(db).findOne(companyId, employeeId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.employee.findFirst.mock.calls[0][0].where).toMatchObject({ id: employeeId, companyId });
  });

  it('update moves invitations to a changed employee number and audits (TEST-003)', async () => {
    const db = createDb({
      employee: {
        findFirst: jest.fn().mockResolvedValue({
          id: employeeId,
          employeeNumber: 'EMP-010',
          fullName: 'Sara Ali',
          phone: null,
        }),
        update: jest.fn().mockResolvedValue({ id: employeeId, employeeNumber: 'EMP-011' }),
      },
    });
    await createService(db).update(companyId, adminUserId, employeeId, { employeeNumber: 'EMP-011' });

    expect(db.companyInvitation.updateMany).toHaveBeenCalledWith({
      where: { companyId, employeeNumber: 'EMP-010' },
      data: { employeeNumber: 'EMP-011' },
    });
    expect(db.auditEvent.create).toHaveBeenCalled();
  });

  describe('setActive (AC-REQ-007-02, AC-REQ-007-05)', () => {
    function activeEmployeeDb() {
      return createDb({
        employee: {
          findFirst: jest.fn().mockResolvedValue({ id: employeeId, userId: employeeUserId }),
          update: jest.fn().mockResolvedValue({ id: employeeId, isActive: false }),
        },
        user: { update: jest.fn().mockResolvedValue({}) },
        extra: { refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } },
      });
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
      expect(db.employee.update.mock.calls[0][0].data).toEqual({
        isActive: true,
        deactivatedAt: null,
        activeFrom: today,
      });
      expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to let an Admin deactivate their own account', async () => {
      const db = activeEmployeeDb();
      db.employee.findFirst.mockResolvedValue({ id: employeeId, userId: adminUserId });
      await expect(
        createService(db).setActive(companyId, adminUserId, employeeId, false),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.user.update).not.toHaveBeenCalled();
    });

    it('refuses an employee who has not accepted the invitation yet', async () => {
      const db = activeEmployeeDb();
      db.employee.findFirst.mockResolvedValue({ id: employeeId, userId: null });
      await expect(
        createService(db).setActive(companyId, adminUserId, employeeId, true),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('invitation resend / revoke (AC-REQ-032-06)', () => {
    const pendingEmployee = { id: employeeId, userId: null, employeeNumber: 'EMP-010', fullName: 'Sara Ali' };

    it('resend revokes the pending invitation and emails a new link', async () => {
      const db = createDb({
        employee: { findFirst: jest.fn().mockResolvedValue(pendingEmployee) },
        companyInvitation: {
          findFirst: jest.fn().mockResolvedValue({ email: 'sara@example.com' }),
        },
      });
      const result = await createService(db).resendInvitation(companyId, adminUserId, employeeId);

      expect(db.companyInvitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId, employeeNumber: 'EMP-010', status: CompanyInvitationStatus.PENDING },
          data: expect.objectContaining({ status: CompanyInvitationStatus.REVOKED }),
        }),
      );
      const token = new URL(result.invitationLink).searchParams.get('token')!;
      expect(db.companyInvitation.create.mock.calls[0][0].data.tokenHash).toBe(sha256(token));
      mailbox.assertSent({ to: 'sara@example.com' });
    });

    it('resend is refused once the employee has a login', async () => {
      const db = createDb({
        employee: { findFirst: jest.fn().mockResolvedValue({ ...pendingEmployee, userId: employeeUserId }) },
      });
      await expect(
        createService(db).resendInvitation(companyId, adminUserId, employeeId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('revoke answers 404 when nothing is pending', async () => {
      const db = createDb({ employee: { findFirst: jest.fn().mockResolvedValue(pendingEmployee) } });
      await expect(
        createService(db).revokeInvitation(companyId, adminUserId, employeeId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('acceptInvitation (AC-REQ-032-02)', () => {
    const token = 'a'.repeat(64);

    function acceptDb(claimedCount: number) {
      return createDb({
        companyInvitation: {
          findUnique: jest.fn().mockResolvedValue({
            id: invitationId,
            companyId,
            email: 'sara@example.com',
            employeeNumber: 'EMP-010',
            invitedByUserId: adminUserId,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: claimedCount }),
        },
        employee: {
          findUnique: jest.fn().mockResolvedValue({ id: employeeId, userId: null }),
          update: jest.fn().mockResolvedValue({}),
        },
        user: { create: jest.fn().mockResolvedValue({ id: employeeUserId, email: 'sara@example.com' }) },
        extra: {
          role: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'role-employee' }) },
          userRole: { create: jest.fn().mockResolvedValue({}) },
        },
      });
    }

    it('rejects a used, revoked or expired invitation without creating a login', async () => {
      const db = acceptDb(0);
      await expect(
        createService(db).acceptInvitation({ token, password: 'correct-horse-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.user.create).not.toHaveBeenCalled();
    });

    it('claims the invitation atomically, then creates and activates the employee login', async () => {
      const db = acceptDb(1);
      const result = await createService(db).acceptInvitation({ token, password: 'correct-horse-1' });

      expect(db.companyInvitation.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256(token) } });
      expect(db.companyInvitation.updateMany.mock.calls[0][0].where).toMatchObject({
        id: invitationId,
        status: CompanyInvitationStatus.PENDING,
      });
      const userData = db.user.create.mock.calls[0][0].data;
      expect(userData).toMatchObject({ companyId, email: 'sara@example.com' });
      expect(userData.passwordHash).toMatch(/^\$argon2id\$/);
      expect(db.role.findUniqueOrThrow).toHaveBeenCalledWith({ where: { name: 'EMPLOYEE' } });
      expect(db.employee.update).toHaveBeenCalledWith({
        where: { id: employeeId },
        data: { userId: employeeUserId, isActive: true, activeFrom: today, deactivatedAt: null },
      });
      expect(result).toEqual({ email: 'sara@example.com' });
    });
  });
});
