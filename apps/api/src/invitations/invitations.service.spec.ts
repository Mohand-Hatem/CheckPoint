import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';

describe('InvitationsService (Unit)', () => {
  let service: InvitationsService;
  let prisma: any;

  const dto = { email: 'New.Person@Acme.com', fullName: 'New Person', employeeCode: 'EMP-9' };
  const hash = (t: string) => createHash('sha256').update(t).digest('hex');

  const pendingInvitation = {
    id: 'inv-1',
    companyId: 'company-A',
    invitedByUserId: 'admin-A',
    email: 'new.person@acme.com',
    fullName: 'New Person',
    employeeNumber: 'EMP-9',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      employee: { findUnique: jest.fn(), create: jest.fn() },
      role: { findUnique: jest.fn() },
      userRole: { create: jest.fn() },
      shift: { findFirst: jest.fn() },
      companyInvitation: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();
    service = module.get(InvitationsService);
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.companyInvitation.updateMany.mockResolvedValue({ count: 0 });
      prisma.companyInvitation.findFirst.mockResolvedValue(null);
    });

    it('stores only the token hash, returns the raw token once, and scopes it to the Admin\'s company', async () => {
      prisma.companyInvitation.create.mockImplementation(async ({ data }: any) => ({ id: 'inv-1', ...data }));

      const result = await service.create('company-A', 'admin-A', dto);

      expect(result.token).toMatch(/^[0-9a-f]{64}$/);
      const stored = prisma.companyInvitation.create.mock.calls[0][0].data;
      expect(stored.tokenHash).toBe(hash(result.token));
      expect(stored).not.toHaveProperty('token');
      expect(stored).toEqual(
        expect.objectContaining({ companyId: 'company-A', invitedByUserId: 'admin-A', email: 'new.person@acme.com' }),
      );
      expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects an email that already has an account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(service.create('company-A', 'admin-A', dto)).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate employee code in the company', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'e1' });
      await expect(service.create('company-A', 'admin-A', dto)).rejects.toThrow(ConflictException);
    });

    it('turns a database unique violation (a concurrent duplicate that slipped past the check) into a 409', async () => {
      prisma.companyInvitation.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.create('company-A', 'admin-A', dto)).rejects.toThrow(ConflictException);
    });

    it('rejects a second pending invitation for the same company and email', async () => {
      prisma.companyInvitation.findFirst.mockResolvedValue({ id: 'inv-old' });
      await expect(service.create('company-A', 'admin-A', dto)).rejects.toThrow(ConflictException);
      expect(prisma.companyInvitation.create).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('answers 404 for another company\'s invitation', async () => {
      prisma.companyInvitation.findFirst.mockResolvedValue(null);

      await expect(service.revoke('company-B', 'inv-1', 'admin-B')).rejects.toThrow(NotFoundException);
      expect(prisma.companyInvitation.findFirst).toHaveBeenCalledWith({ where: { id: 'inv-1', companyId: 'company-B' } });
      expect(prisma.companyInvitation.update).not.toHaveBeenCalled();
    });

    it('cannot revoke an invitation that is no longer pending', async () => {
      prisma.companyInvitation.findFirst.mockResolvedValue({ ...pendingInvitation, status: 'ACCEPTED' });
      await expect(service.revoke('company-A', 'inv-1', 'admin-A')).rejects.toThrow(ConflictException);
    });
  });

  describe('accept', () => {
    it('looks up by token hash, then creates user, role and employee in the INVITER\'s company', async () => {
      prisma.companyInvitation.findUnique.mockResolvedValue(pendingInvitation);
      prisma.companyInvitation.updateMany.mockResolvedValue({ count: 1 });
      prisma.role.findUnique.mockResolvedValue({ id: 'role-employee' });
      prisma.shift.findFirst.mockResolvedValue({ id: 'shift-A' });
      prisma.user.create.mockResolvedValue({ id: 'new-user' });

      const result = await service.accept({ token: 'raw-token', password: 'Password123!' });

      expect(prisma.companyInvitation.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hash('raw-token') } });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'company-A', email: 'new.person@acme.com' }),
      });
      expect(prisma.employee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'company-A', employeeNumber: 'EMP-9', currentShiftId: 'shift-A' }),
      });
      expect(result.email).toBe('new.person@acme.com');
    });

    it.each([
      ['unknown token', null],
      ['revoked', { ...pendingInvitation, status: 'REVOKED' }],
      ['already accepted', { ...pendingInvitation, status: 'ACCEPTED' }],
      ['expired', { ...pendingInvitation, expiresAt: new Date(Date.now() - 1000) }],
    ])('rejects a %s invitation with one generic message', async (_name, invitation) => {
      prisma.companyInvitation.findUnique.mockResolvedValue(invitation);

      await expect(service.accept({ token: 'x', password: 'Password123!' })).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('is single-use: a concurrent accept that loses the claim creates nothing', async () => {
      prisma.companyInvitation.findUnique.mockResolvedValue(pendingInvitation);
      prisma.companyInvitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.accept({ token: 'raw', password: 'Password123!' })).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.employee.create).not.toHaveBeenCalled();
    });
  });
});
