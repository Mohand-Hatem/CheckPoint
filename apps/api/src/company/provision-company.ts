import { PointType, Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { recordAuditEvent } from '../audit/record-audit-event';

// Roles are platform-wide reference data (docs/08 §3.1); permissions follow resource.action[.scope].
export const ROLES: Record<string, { description: string; permissions: string[] }> = {
  ADMIN: {
    description: 'Administrator',
    permissions: [
      'auth.read',
      'auth.write',
      'users.read',
      'users.write',
      'attendance.read',
      'attendance.write',
      'attendance.checkin',
      'leaves.read',
      'leaves.write',
      'leaves.approve',
      'points.read',
      'points.write',
      'points.adjust',
      'payroll.read',
      'payroll.write',
      'reports.read',
      'settings.read',
      'settings.write',
      'audit.read',
    ],
  },
  EMPLOYEE: {
    description: 'Employee',
    permissions: [
      'attendance.checkin',
      'attendance.read.self',
      'leaves.request',
      'leaves.read.self',
      'points.read.self',
      'payroll.read.self',
    ],
  },
};

// EGP only (spec REQ-020/REQ-029). WHITE has no money value, so it has no row.
const POINT_VALUES: [PointType, number][] = [
  [PointType.GREEN, 1000],
  [PointType.RED, 250],
  [PointType.BLACK, 1000],
];

// docs/08 §3.8 defaults for a new company.
const DEFAULT_SETTINGS: Record<string, Prisma.InputJsonValue> = {
  timezone: 'Africa/Cairo',
  weekly_off_days: ['FRI', 'SAT'],
  gps_max_accuracy_m: 50,
  qr_verification_window_minutes: 15,
  qr_rotation_seconds: 30,
  overtime_unit_minutes: 60,
  offset_reds_per_green: 1,
  offset_greens_per_black: 5,
  deduction_policy: { red_enabled: false, black_enabled: false, cap_percent_of_base: null },
  leave_pay_policy: { ANNUAL: { unpaid: false }, SICK: { unpaid: false }, UNPAID: { unpaid: true } },
  withdrawal_limits: { min_egp: null, daily_max_egp: null, monthly_max_egp: null },
  absence_lookback_days: 7,
};

const DEFAULT_SHIFT_NAME = 'Default 08-16';
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ProvisionCompanyInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminFullName?: string;
  employeeNumber?: string;
  /** When omitted, a random password is generated and returned once. */
  adminPassword?: string;
  mustChangePassword?: boolean;
}

export interface ProvisionCompanyResult {
  companyId: string;
  adminUserId: string;
  adminEmail: string;
  /** Present only when it was generated, and never on a retry. */
  generatedAdminPassword?: string;
  /** True when the same slug and Admin email already existed: nothing was created or changed. */
  alreadyProvisioned: boolean;
}

/** Creates roles and permissions if missing. Idempotent; shared by every company. */
export async function seedRolesAndPermissions(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<Record<string, string>> {
  const roleIds: Record<string, string> = {};
  for (const [name, { description, permissions }] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { description },
      create: { name, description, isSystem: true },
    });
    roleIds[name] = role.id;

    for (const code of permissions) {
      const permission = await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
  return roleIds;
}

function utcTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

/**
 * Creates a company, its default configuration and its first Admin in ONE transaction
 * (spec REQ-031). Not reachable over HTTP: only the provisioning command and tests call it.
 */
export async function provisionCompany(
  prisma: PrismaClient,
  input: ProvisionCompanyInput,
): Promise<ProvisionCompanyResult> {
  const name = input.name?.trim();
  const slug = input.slug?.trim().toLowerCase();
  const adminEmail = input.adminEmail?.trim().toLowerCase();

  if (!name) throw new Error('Company name is required');
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new Error('Company slug must be 2-41 chars: lowercase letters, digits and dashes');
  }
  if (!adminEmail || !EMAIL_PATTERN.test(adminEmail)) throw new Error('A valid admin email is required');
  if (input.adminPassword !== undefined && input.adminPassword.length < 8) {
    throw new Error('Admin password must be at least 8 characters');
  }

  const generatedAdminPassword = input.adminPassword ? undefined : randomBytes(12).toString('base64url');
  const passwordHash = await argon2.hash(input.adminPassword ?? generatedAdminPassword!, {
    type: argon2.argon2id,
  });

  const roleIds = await seedRolesAndPermissions(prisma);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  try {
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name, slug } });
      const companyId = company.id;

      await tx.setting.createMany({
        data: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ companyId, key, value })),
      });

      await tx.pointValueVersion.createMany({
        data: POINT_VALUES.map(([pointType, value]) => ({
          companyId,
          pointType,
          value,
          effectiveFrom: monthStart,
        })),
      });

      // GREEN 08:00-08:59, WHITE 09:00-09:59, RED 10:00-11:59, BLACK from 12:00 (spec REQ-012)
      const shift = await tx.shift.create({ data: { companyId, name: DEFAULT_SHIFT_NAME } });
      await tx.shiftVersion.create({
        data: {
          companyId,
          shiftId: shift.id,
          startTime: utcTime('08:00'),
          endTime: utcTime('16:00'),
          earlyMinutes: 60,
          graceMinutes: 120,
          redPeriodMinutes: 240,
          effectiveFrom: monthStart,
          // Sunday-Thursday, matching weekly_off_days FRI/SAT
          weekdays: { create: [0, 1, 2, 3, 4].map((weekday) => ({ companyId, weekday })) },
        },
      });

      const admin = await tx.user.create({
        data: {
          companyId,
          email: adminEmail,
          passwordHash,
          isActive: true,
          mustChangePassword: input.mustChangePassword ?? true,
        },
      });
      await tx.userRole.create({ data: { userId: admin.id, roleId: roleIds.ADMIN } });
      await tx.employee.create({
        data: {
          companyId,
          userId: admin.id,
          employeeNumber: input.employeeNumber ?? 'ADMIN-001',
          fullName: input.adminFullName ?? 'Company Administrator',
          currentShiftId: shift.id,
        },
      });
      await tx.company.update({ where: { id: companyId }, data: { ownerUserId: admin.id } });
      await recordAuditEvent(tx, {
        companyId,
        actorType: 'SYSTEM',
        action: 'company.provision',
        targetType: 'company',
        targetId: companyId,
        changes: { name, slug, adminEmail },
      });

      return { companyId, adminUserId: admin.id };
    });

    return { ...result, adminEmail, generatedAdminPassword, alreadyProvisioned: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // The unique index decided the winner, so a concurrent retry lands here too.
      const existing = await prisma.company.findUnique({ where: { slug }, include: { owner: true } });
      if (!existing) throw new Error(`An account with the email ${adminEmail} already exists`);
      if (existing.owner?.email === adminEmail) {
        return { companyId: existing.id, adminUserId: existing.owner.id, adminEmail, alreadyProvisioned: true };
      }
      throw new Error(`A company with the slug "${slug}" already exists with a different first Admin`);
    }
    throw error;
  }
}
