import { AuditService } from './audit.service';
import { recordAuditEvent } from './record-audit-event';

describe('Audit events (unit)', () => {
  describe('recordAuditEvent', () => {
    it('writes one event with the actor, target and changes, and null for what is absent', async () => {
      const create = jest.fn().mockResolvedValue({});

      await recordAuditEvent({ auditEvent: { create } } as any, {
        companyId: 'company-1', actorType: 'SYSTEM', action: 'company.provision', targetType: 'company', targetId: 'company-1',
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1', actorUserId: null, actorType: 'SYSTEM', action: 'company.provision',
          targetType: 'company', targetId: 'company-1', reason: null, changes: {},
        },
      });
    });
  });

  describe('AuditService.list', () => {
    let prisma: any;
    let service: AuditService;

    beforeEach(() => {
      prisma = { auditEvent: { count: jest.fn().mockResolvedValue(45), findMany: jest.fn().mockResolvedValue([]) } };
      service = new AuditService(prisma);
    });

    it('is always limited to the caller\'s company and newest first', async () => {
      await service.list('company-A', {});

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'company-A' }, orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }),
      );
    });

    it('applies filters and pagination, and reports the page count', async () => {
      const result = await service.list('company-A', { page: 3, limit: 10, action: 'user.create', targetId: 'u1', actorUserId: 'a1', targetType: 'user' });

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-A', action: 'user.create', targetId: 'u1', actorUserId: 'a1', targetType: 'user' },
          skip: 20,
          take: 10,
        }),
      );
      expect(result).toEqual(expect.objectContaining({ total: 45, page: 3, limit: 10, totalPages: 5 }));
    });
  });
});
