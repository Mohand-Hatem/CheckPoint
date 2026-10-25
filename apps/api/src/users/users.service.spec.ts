import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { HttpException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { LoginThrottleService } from '../auth/guards/login-throttle.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService (Unit)', () => {
  let service: UsersService;
  let prisma: any;
  let throttle: { retryAfterSeconds: jest.Mock; recordFailure: jest.Mock; reset: jest.Mock };
  let audit: { record: jest.Mock };

  const validDto = {
    email: 'valid@checkpoint.local',
    fullName: 'Valid User',
    employeeCode: 'EMP-001',
    password: 'Password123!',
    roleCode: 'EMPLOYEE',
  };

  const userView = {
    id: 'new-user-1',
    email: 'valid@checkpoint.local',
    isActive: true,
    mustChangePassword: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    roles: [{ role: { name: 'EMPLOYEE', description: 'Employee' } }],
    employee: {
      fullName: 'Valid User',
      employeeNumber: 'EMP-001',
      phone: null,
      activeFrom: new Date(),
      deactivatedAt: null,
      compensationVersions: [],
    },
  };

  beforeEach(async () => {
    throttle = { retryAfterSeconds: jest.fn().mockReturnValue(0), recordFailure: jest.fn(), reset: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue({}) };
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      employee: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      role: {
        findUnique: jest.fn(),
      },
      userRole: {
        create: jest.fn(),
      },
      shift: {
        findFirst: jest.fn(),
      },
      employeeSalaryVersion: {
        create: jest.fn(),
        upsert: jest.fn(),
      },
      refreshToken: {
        updateMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoginThrottleService, useValue: throttle },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUser', () => {
    it('should throw ConflictException if email is already in use', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-id' });

      await expect(service.createUser('company-1', { ...validDto, email: 'dup@checkpoint.local' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException if the employee code is already in use', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-existing' });

      await expect(service.createUser('company-1', validDto)).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if role does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.createUser('company-1', { ...validDto, roleCode: 'NONEXISTENT' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if no active shift exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'EMPLOYEE' });
      prisma.shift.findFirst.mockResolvedValue(null);

      await expect(service.createUser('company-1', validDto)).rejects.toThrow(BadRequestException);
    });

    it('should create user, role link and employee without returning passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'EMPLOYEE' });
      prisma.shift.findFirst.mockResolvedValue({ id: 'shift-1' });
      prisma.user.create.mockResolvedValue({ id: 'new-user-1', passwordHash: '$argon2id$...' });
      prisma.employee.create.mockResolvedValue({ id: 'emp-1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue(userView);

      const result = await service.createUser('company-1', { ...validDto, initialSalary: 12000 });

      expect(result.id).toBe('new-user-1');
      expect(result.role).toEqual({ code: 'EMPLOYEE', name: 'Employee' });
      expect((result as any).passwordHash).toBeUndefined();
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'company-1', email: 'valid@checkpoint.local' }),
      });
      expect(prisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'new-user-1', roleId: 'role-1', assignedByUserId: null },
      });
      expect(prisma.employee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ employeeNumber: 'EMP-001', currentShiftId: 'shift-1' }),
      });
      expect(prisma.employeeSalaryVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ employeeId: 'emp-1', salary: 12000 }),
      });
    });
  });

  describe('createSalary', () => {
    it('should reject salary if effectiveFrom is NOT the 1st of the month', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });

      await expect(
        service.createSalary('company-1', 'user-1', {
          amount: 15000,
          effectiveFrom: '2026-11-15',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if the user has no employee record', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.createSalary('company-1', 'user-1', { amount: 15000, effectiveFrom: '2026-11-01' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should accept salary when effectiveFrom is the 1st of the month', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      prisma.employeeSalaryVersion.upsert.mockResolvedValue({
        id: 'sal-1',
        salary: 15000,
        effectiveFrom: new Date('2026-11-01'),
        createdAt: new Date(),
      });

      const result = await service.createSalary('company-1', 'user-1', {
        amount: 15000,
        effectiveFrom: '2026-11-01',
      });

      expect(result.amount).toBe(15000);
      expect(result.currency).toBe('EGP');
      expect(prisma.employeeSalaryVersion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            employeeId_effectiveFrom: { employeeId: 'emp-1', effectiveFrom: new Date('2026-11-01T00:00:00.000Z') },
          },
        }),
      );
    });
  });

  describe('updateUserStatus', () => {
    it('should purge active refresh tokens and stop BLACKs when deactivating a user', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1', employee: { id: 'emp-1' } });
      prisma.user.update.mockResolvedValue({});
      prisma.employee.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ ...userView, id: 'user-1', isActive: false });

      const result = await service.updateUserStatus('company-1', 'user-1', false);

      expect(result.active).toBe(false);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { deactivatedAt: expect.any(Date) },
      });
    });
  });

  describe('getMyProfile (own record only)', () => {
    it('selects by the session user id and company, and returns no salary data', async () => {
      prisma.user.findFirst.mockResolvedValue(userView);

      const profile = await service.getMyProfile('company-1', 'new-user-1');

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'new-user-1', companyId: 'company-1' } }),
      );
      expect(profile).toEqual(
        expect.objectContaining({ id: 'new-user-1', email: 'valid@checkpoint.local', role: 'EMPLOYEE', employeeCode: 'EMP-001' }),
      );
      expect(profile).not.toHaveProperty('salaries');
      expect(profile).not.toHaveProperty('currentSalary');
    });

    it('answers 404 when the account is not in the session company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getMyProfile('company-A', 'user-of-B')).rejects.toThrow(NotFoundException);
    });
  });


  describe('changeMyPassword', () => {
    const ACTOR = { userId: 'user-1', companyId: 'company-1', role: 'EMPLOYEE' };
    let current: string;
    beforeAll(async () => {
      current = await argon2.hash('Current#Pass1', { type: argon2.argon2id });
    });

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: current });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    });

    it('sets the new hash, clears mustChangePassword and ends every session in one transaction', async () => {
      await service.changeMyPassword(ACTOR, { currentPassword: 'Current#Pass1', newPassword: 'Another#Pass2' });

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.mustChangePassword).toBe(false);
      expect(await argon2.verify(data.passwordHash, 'Another#Pass2')).toBe(true);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(throttle.reset).toHaveBeenCalledWith('pwd:user-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ companyId: 'company-1', actorUserId: 'user-1', actorType: 'EMPLOYEE', action: 'password.change', changes: { sessionsRevoked: 2 } }),
      );
    });

    it('rejects a wrong current password, counts a failure and changes nothing', async () => {
      audit.record.mockClear();
      await expect(service.changeMyPassword(ACTOR, { currentPassword: 'wrong', newPassword: 'Another#Pass2' })).rejects.toThrow(BadRequestException);
      expect(throttle.recordFailure).toHaveBeenCalledWith('pwd:user-1');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a new password equal to the current one', async () => {
      await expect(service.changeMyPassword(ACTOR, { currentPassword: 'Current#Pass1', newPassword: 'Current#Pass1' })).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('answers 429 before checking anything while the user is over the failure limit', async () => {
      throttle.retryAfterSeconds.mockReturnValue(42);
      await expect(service.changeMyPassword(ACTOR, { currentPassword: 'Current#Pass1', newPassword: 'Another#Pass2' })).rejects.toThrow(HttpException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('company scope (spec REQ-033)', () => {
    it('getUserById filters by the session company and answers 404 for a foreign record', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getUserById('company-A', 'user-of-company-B')).rejects.toThrow(NotFoundException);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-of-company-B', companyId: 'company-A' } }),
      );
    });

    it('getUsers only lists the session company', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);

      await service.getUsers('company-A');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-A' }) }),
      );
    });

    it('updateUserStatus answers 404 for a user of another company and changes nothing', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.updateUserStatus('company-A', 'user-of-company-B', false)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('createSalary answers 404 when the employee is not in the session company', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.createSalary('company-A', 'user-of-company-B', { amount: 1, effectiveFrom: '2026-11-01' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-of-company-B', companyId: 'company-A' } }),
      );
      expect(prisma.employeeSalaryVersion.upsert).not.toHaveBeenCalled();
    });
  });
});
