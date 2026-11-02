import { Prisma } from '@prisma/client';

export type AuditActorType = 'ADMIN' | 'EMPLOYEE' | 'SYSTEM';

export interface AuditEntry {
  companyId: string;
  /** Null for system events (for example provisioning). */
  actorUserId?: string | null;
  actorType: AuditActorType;
  /** Dotted verb, for example user.create, salary.set, invitation.revoke. */
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string;
  /** What changed. NEVER put passwords, hashes or tokens here. */
  changes?: Prisma.InputJsonValue;
}

/** Anything with an auditEvent delegate: the PrismaService itself or a transaction client. */
export type AuditDb = { auditEvent: Pick<Prisma.AuditEventDelegate, 'create'> };

/**
 * Writes one audit event. Pass the SAME transaction client as the change being audited, so a failed
 * action leaves no event behind and a recorded event always has its change.
 */
export function recordAuditEvent(db: AuditDb, entry: AuditEntry) {
  return db.auditEvent.create({
    data: {
      companyId: entry.companyId,
      actorUserId: entry.actorUserId ?? null,
      actorType: entry.actorType,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      reason: entry.reason ?? null,
      changes: entry.changes ?? {},
    },
  });
}
