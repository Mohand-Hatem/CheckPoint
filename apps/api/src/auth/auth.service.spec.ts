import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService (Unit)', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;
  let configService: any;

  const mockUser = {
    id: 'user-uuid-1',
    email: 'admin@checkpoint.local',
    passwordHash: '',
    isActive: true,
    mustChangePassword: false,
    employee: { fullName: 'System Admin' },
    roles: [
      {
        role: {
          name: 'ADMIN',
          permissions: [
            { permission: { code: 'users.read' } },
            { permission: { code: 'users.write' } },
          ],
        },
      },
    ],
  };

  beforeAll(async () => {
    mockUser.passwordHash = await argon2.hash('Secret123!', { type: argon2.argon2id });
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('mock-access-token'),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string, defaultVal: string) => defaultVal || '30'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should authenticate user and return access & refresh tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.login({
        email: 'admin@checkpoint.local',
        password: 'Secret123!',
      });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('admin@checkpoint.local');
      expect(result.user.role).toBe('ADMIN');
      expect(result.user.fullName).toBe('System Admin');
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'ADMIN', permissions: ['users.read', 'users.write'] }),
      );
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('should reject a user with no role assigned', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, roles: [] });

      await expect(
        service.login({ email: 'admin@checkpoint.local', password: 'Secret123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@checkpoint.local', password: 'Secret123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for deactivated user', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(
        service.login({ email: 'admin@checkpoint.local', password: 'Secret123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for incorrect password', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.login({ email: 'admin@checkpoint.local', password: 'WrongPassword!' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('should detect token reuse (theft) and burn the entire family', async () => {
      const spentToken = {
        id: 'token-old',
        familyId: 'family-100',
        userId: 'user-uuid-1',
        revokedAt: new Date(), // already revoked!
        expiresAt: new Date(Date.now() + 100000),
        user: { ...mockUser },
      };

      prisma.refreshToken.findUnique.mockResolvedValue(spentToken);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(
        service.refresh({ refreshToken: 'spent-token-string' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-100' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should rotate valid refresh token cleanly', async () => {
      const validToken = {
        id: 'token-valid',
        familyId: 'family-200',
        userId: 'user-uuid-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000000),
        user: { ...mockUser },
      };

      prisma.refreshToken.findUnique.mockResolvedValue(validToken);
      prisma.$transaction.mockResolvedValue([{ id: 'new-token-id' }, {}]);
      prisma.refreshToken.update.mockResolvedValue({});

      const result = await service.refresh({ refreshToken: 'valid-token' });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should revoke all tokens in the token family', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-id',
        familyId: 'family-300',
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.logout({ refreshToken: 'some-token' });

      expect(result.success).toBe(true);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-300' },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
