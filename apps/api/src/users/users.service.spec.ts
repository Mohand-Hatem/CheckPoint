import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService (Unit)', () => {
  let service: UsersService;
  let prisma: any;

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
        { provide: CompanyContextService, useValue: { getCompanyId: jest.fn().mockResolvedValue('company-1') } },
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

      await expect(service.createUser({ ...validDto, email: 'dup@checkpoint.local' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException if the employee code is already in use', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-existing' });

      await expect(service.createUser(validDto)).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if role does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.createUser({ ...validDto, roleCode: 'NONEXISTENT' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if no active shift exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'EMPLOYEE' });
      prisma.shift.findFirst.mockResolvedValue(null);

      await expect(service.createUser(validDto)).rejects.toThrow(BadRequestException);
    });

    it('should create user, role link and employee without returning passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'EMPLOYEE' });
      prisma.shift.findFirst.mockResolvedValue({ id: 'shift-1' });
      prisma.user.create.mockResolvedValue({ id: 'new-user-1', passwordHash: '$argon2id$...' });
      prisma.employee.create.mockResolvedValue({ id: 'emp-1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue(userView);

      const result = await service.createUser({ ...validDto, initialSalary: 12000 });

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
        service.createSalary('user-1', {
          amount: 15000,
          effectiveFrom: '2026-11-15',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if the user has no employee record', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.createSalary('user-1', { amount: 15000, effectiveFrom: '2026-11-01' }),
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

      const result = await service.createSalary('user-1', {
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

      const result = await service.updateUserStatus('user-1', false);

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
});
