import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditDb, AuditEntry, recordAuditEvent } from './record-audit-event';
import { ListAuditEventsQuery } from './dto/audit.dto';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Call with the transaction client of the change being audited. */
  record(db: AuditDb, entry: AuditEntry) {
    return recordAuditEvent(db, entry);
  }

  async list(companyId: string, query: ListAuditEventsQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.AuditEventWhereInput = {
      companyId, // always the caller's own company
      ...(query.action && { action: query.action }),
      ...(query.targetType && { targetType: query.targetType }),
      ...(query.targetId && { targetId: query.targetId }),
      ...(query.actorUserId && { actorUserId: query.actorUserId }),
    };

    const [total, data] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, createdAt: true, actorUserId: true, actorType: true, action: true,
          targetType: true, targetId: true, reason: true, changes: true,
        },
      }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
