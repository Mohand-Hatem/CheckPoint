import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting CheckPoint database seeding...');

  // 1. Roles
  const adminRole = await prisma.role.upsert({
    where: { code: 'ADMIN' },
    update: { name: 'Administrator' },
    create: {
      code: 'ADMIN',
      name: 'Administrator',
    },
  });

  const employeeRole = await prisma.role.upsert({
    where: { code: 'EMPLOYEE' },
    update: { name: 'Employee' },
    create: {
      code: 'EMPLOYEE',
      name: 'Employee',
    },
  });

  console.log('✅ Roles seeded: ADMIN, EMPLOYEE');

  // 2. Role Permissions
  const adminPermissions = [
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
  ];

  const employeePermissions = [
    'attendance.checkin',
    'attendance.read.self',
    'leaves.request',
    'leaves.read.self',
    'points.read.self',
    'payroll.read.self',
  ];

  for (const perm of adminPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permission: {
          roleId: adminRole.id,
          permission: perm,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permission: perm,
      },
    });
  }

  for (const perm of employeePermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permission: {
          roleId: employeeRole.id,
          permission: perm,
        },
      },
      update: {},
      create: {
        roleId: employeeRole.id,
        permission: perm,
      },
    });
  }

  console.log('✅ Role permissions mapped');

  // 3. Default System Administrator User
  const defaultAdminEmail = 'admin@checkpoint.local';
  const defaultAdminPassword = 'AdminPassword123!';
  const hashedPassword = await argon2.hash(defaultAdminPassword, {
    type: argon2.argon2id,
  });

  const adminUser = await prisma.user.upsert({
    where: { email: defaultAdminEmail },
    update: {
      roleId: adminRole.id,
      active: true,
    },
    create: {
      email: defaultAdminEmail,
      fullName: 'System Administrator',
      passwordHash: hashedPassword,
      roleId: adminRole.id,
      active: true,
      mustChangePassword: false,
    },
  });

  console.log(`✅ Default Admin user seeded: ${adminUser.email}`);

  // 4. Default Settings (Work schedule & Point rules)
  await prisma.setting.upsert({
    where: { key: 'work_schedule' },
    update: {
      value: {
        startTime: '08:00',
        endTime: '16:00',
        gracePeriodMinutes: 15,
        workDays: ['SUN', 'MON', 'TUE', 'WED', 'THU'],
      },
    },
    create: {
      key: 'work_schedule',
      value: {
        startTime: '08:00',
        endTime: '16:00',
        gracePeriodMinutes: 15,
        workDays: ['SUN', 'MON', 'TUE', 'WED', 'THU'],
      },
    },
  });

  await prisma.setting.upsert({
    where: { key: 'point_rules' },
    update: {
      value: {
        onTimeArrival: 10,
        lateArrivalDeduction: 5,
        unexcusedAbsenceDeduction: 20,
      },
    },
    create: {
      key: 'point_rules',
      value: {
        onTimeArrival: 10,
        lateArrivalDeduction: 5,
        unexcusedAbsenceDeduction: 20,
      },
    },
  });

  console.log('✅ Default system settings seeded (work_schedule, point_rules)');
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
