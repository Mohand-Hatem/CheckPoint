import { PointType, Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// The deployment's single company (spec REQ-NFR-008, docs/08 §3.0).
const COMPANY_SLUG = 'default';
const DEFAULT_SHIFT_NAME = 'Default 08-16';

const ROLES: Record<string, { description: string; permissions: string[] }> = {
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

// docs/08 §3.8 defaults. Admin edits are never overwritten by a re-run.
const SETTINGS: Record<string, Prisma.InputJsonValue> = {
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

function utcTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

async function main() {
  console.log('🌱 Starting CheckPoint database seeding...');

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // 1. The single company
  const company = await prisma.company.upsert({
    where: { slug: COMPANY_SLUG },
    update: {},
    create: { name: 'CheckPoint Company', slug: COMPANY_SLUG },
  });
  const companyCount = await prisma.company.count();
  if (companyCount !== 1) {
    throw new Error(`Expected exactly one company, found ${companyCount}`);
  }
  const companyId = company.id;
  console.log(`✅ Company seeded: ${company.slug}`);

  // 2. Roles and permissions
  const roleIds: Record<string, string> = {};
  for (const [name, { description, permissions }] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { description },
      create: { name, description, isSystem: true },
    });
    roleIds[name] = role.id;

    for (const code of permissions) {
      const permission = await prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
  console.log('✅ Roles and permissions seeded: ADMIN, EMPLOYEE');

  // 3. Default shift: GREEN 08:00-08:59, WHITE 09:00-09:59, RED 10:00-11:59, BLACK from 12:00
  const shift = await prisma.shift.upsert({
    where: { companyId_name: { companyId, name: DEFAULT_SHIFT_NAME } },
    update: {},
    create: { companyId, name: DEFAULT_SHIFT_NAME },
  });
  const existingVersion = await prisma.shiftVersion.findFirst({ where: { shiftId: shift.id } });
  if (!existingVersion) {
    await prisma.shiftVersion.create({
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
  }
  console.log(`✅ Default shift seeded: ${DEFAULT_SHIFT_NAME}`);

  // 4. Point values in EGP
  for (const [pointType, value] of POINT_VALUES) {
    const existing = await prisma.pointValueVersion.findFirst({ where: { companyId, pointType } });
    if (!existing) {
      await prisma.pointValueVersion.create({
        data: { companyId, pointType, value, effectiveFrom: monthStart },
      });
    }
  }
  console.log('✅ Point values seeded: GREEN 1000, RED 250, BLACK 1000 EGP');

  // 5. Settings
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({
      where: { companyId_key: { companyId, key } },
      update: {},
      create: { companyId, key, value },
    });
  }
  console.log('✅ Default settings seeded');

  // 6. Development admin (never in production; docs/08 §7)
  if (process.env.NODE_ENV === 'production') {
    console.log('⏭️  Production: skipping the development admin account');
  } else {
    const email = 'admin@checkpoint.local';
    const passwordHash = await argon2.hash('AdminPassword123!', { type: argon2.argon2id });

    const admin = await prisma.user.upsert({
      where: { email },
      update: { isActive: true },
      create: { companyId, email, passwordHash, isActive: true, mustChangePassword: false },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: roleIds.ADMIN } },
      update: {},
      create: { userId: admin.id, roleId: roleIds.ADMIN },
    });
    await prisma.employee.upsert({
      where: { userId: admin.id },
      update: {},
      create: {
        companyId,
        userId: admin.id,
        employeeNumber: 'ADMIN-001',
        fullName: 'System Administrator',
        currentShiftId: shift.id,
      },
    });
    console.log(`✅ Development admin seeded: ${email}`);
  }

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
