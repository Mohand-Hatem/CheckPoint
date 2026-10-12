import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService (Unit)', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      role: {
        findUnique: jest.fn(),
      },
      employeeSalary: {
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

      await expect(
        service.createUser({
          email: 'dup@checkpoint.local',
          fullName: 'Duplicate User',
          password: 'Password123!',
          roleCode: 'EMPLOYEE',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if role does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(
        service.createUser({
          email: 'valid@checkpoint.local',
          fullName: 'Valid User',
          password: 'Password123!',
          roleCode: 'NONEXISTENT',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create user without returning passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', code: 'EMPLOYEE', name: 'Employee' });
      prisma.user.create.mockResolvedValue({
        id: 'new-user-1',
        email: 'valid@checkpoint.local',
        fullName: 'Valid User',
        passwordHash: '$argon2id$...',
        role: { code: 'EMPLOYEE', name: 'Employee' },
      });

      const result = await service.createUser({
        email: 'valid@checkpoint.local',
        fullName: 'Valid User',
        password: 'Password123!',
        roleCode: 'EMPLOYEE',
      });

      expect(result.id).toBe('new-user-1');
      expect((result as any).passwordHash).toBeUndefined();
      expect(prisma.user.create).toHaveBeenCalled();
    });
  });

  describe('createSalary', () => {
    it('should reject salary if effectiveFrom is NOT the 1st of the month', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(
        service.createSalary('user-1', {
          amount: 15000,
          effectiveFrom: '2026-11-15',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept salary when effectiveFrom is the 1st of the month', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.employeeSalary.upsert.mockResolvedValue({
        id: 'sal-1',
        amount: 15000,
        effectiveFrom: new Date('2026-11-01'),
      });

      const result = await service.createSalary('user-1', {
        amount: 15000,
        effectiveFrom: '2026-11-01',
      });

      expect(result.amount).toBe(15000);
      expect(prisma.employeeSalary.upsert).toHaveBeenCalled();
    });
  });

  describe('updateUserStatus', () => {
    it('should purge active refresh tokens when deactivating a user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.user.update.mockResolvedValue({ id: 'user-1', active: false });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await service.updateUserStatus('user-1', false);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
