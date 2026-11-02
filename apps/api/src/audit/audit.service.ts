import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditEventsQuery } from './dto/list-audit-events.query';

export interface AuditRecord {
  companyId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  changes?: Prisma.InputJsonObject;
  reason?: string;
  actorType?: 'ADMIN' | 'EMPLOYEE' | 'SYSTEM';
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Always called with the business transaction, so the audit row commits or rolls back with the change.
  record(tx: Prisma.TransactionClient, { actorType = 'ADMIN', ...entry }: AuditRecord) {
    return tx.auditEvent.create({ data: { ...entry, actorType } });
  }

  async list(companyId: string, query: ListAuditEventsQuery) {
    const where: Prisma.AuditEventWhereInput = {
      companyId,
      ...(query.targetType && { targetType: query.targetType }),
      ...(query.targetId && { targetId: query.targetId }),
      ...(query.actorUserId && { actorUserId: query.actorUserId }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(`${query.from}T00:00:00.000Z`) }),
          // `to` is an inclusive date
          ...(query.to && { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS) }),
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { actor: { select: { id: true, email: true } } },
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
