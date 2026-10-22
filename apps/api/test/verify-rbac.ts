import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as assert from 'assert';
import { AppModule } from '../src/app.module';

const prisma = new PrismaClient();

async function runRbacVerification() {
  console.log('🧪 Starting RBAC, Guards & Throttling automated verification...');

  // 1. Ensure test employee user exists
  const company = await prisma.company.findFirstOrThrow();
  const shift = await prisma.shift.findFirstOrThrow({ where: { companyId: company.id } });
  const employeeRole = await prisma.role.findUnique({ where: { name: 'EMPLOYEE' } });
  assert.ok(employeeRole, 'EMPLOYEE role must exist');

  const employeePassword = await argon2.hash('EmployeePass123!', { type: argon2.argon2id });
  const testUser = await prisma.user.upsert({
    where: { email: 'employee@checkpoint.local' },
    update: { isActive: true },
    create: {
      companyId: company.id,
      email: 'employee@checkpoint.local',
      passwordHash: employeePassword,
      isActive: true,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: testUser.id, roleId: employeeRole.id } },
    update: {},
    create: { userId: testUser.id, roleId: employeeRole.id },
  });
  await prisma.employee.upsert({
    where: { userId: testUser.id },
    update: {},
    create: {
      companyId: company.id,
      userId: testUser.id,
      employeeNumber: 'RBAC-TEST-001',
      fullName: 'Test Employee',
      currentShiftId: shift.id,
    },
  });

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = 4098;
  await app.listen(port);
  const baseUrl = `http://localhost:${port}/api`;

  try {
    // 2. Unauthenticated request to protected endpoint
    console.log('  Testing unauthenticated access to /auth/me...');
    const unauthRes = await fetch(`${baseUrl}/auth/me`);
    assert.strictEqual(unauthRes.status, 401, 'Should reject unauthenticated request with 401');
    console.log('  ✅ Unauthenticated request rejected (401)');

    // 3. Login as Admin
    console.log('  Logging in as admin...');
    const adminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@checkpoint.local',
        password: 'AdminPassword123!',
      }),
    });
    const adminData = await adminLoginRes.json();
    assert.ok(adminData.accessToken, 'Admin access token must be returned');

    // 4. Access /auth/me with Admin token
    console.log('  Testing authenticated @CurrentUser() profile...');
    const profileRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${adminData.accessToken}` },
    });
    assert.strictEqual(profileRes.status, 200, 'Should allow access with valid token');
    const profile = await profileRes.json();
    assert.strictEqual(profile.email, 'admin@checkpoint.local');
    assert.strictEqual(profile.role, 'ADMIN');
    console.log('  ✅ @CurrentUser() returned correct authenticated user');

    // 5. Test permission pass: Admin accessing endpoint requiring 'users.read'
    console.log('  Testing RBAC: Admin accessing users.read endpoint...');
    const permPassRes = await fetch(`${baseUrl}/auth/test-permission`, {
      headers: { Authorization: `Bearer ${adminData.accessToken}` },
    });
    assert.strictEqual(permPassRes.status, 200, 'Admin should have users.read permission');
    console.log('  ✅ Admin allowed access to users.read endpoint (200)');

    // 6. Test permission fail: Employee accessing endpoint requiring 'users.read'
    console.log('  Logging in as employee (without users.read)...');
    const empLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'employee@checkpoint.local',
        password: 'EmployeePass123!',
      }),
    });
    const empData = await empLoginRes.json();

    console.log('  Testing RBAC: Employee accessing users.read endpoint...');
    const permFailRes = await fetch(`${baseUrl}/auth/test-permission`, {
      headers: { Authorization: `Bearer ${empData.accessToken}` },
    });
    assert.strictEqual(permFailRes.status, 403, 'Employee must be rejected with 403 Forbidden');
    const failData = await permFailRes.json();
    assert.ok(failData.message.includes('requires permission'), 'Should state required permission');
    console.log('  ✅ Employee access correctly denied with 403 Forbidden');

    // 7. Login Throttle Guard test
    console.log('  Testing Login Throttling (rate limiter)...');
    const throttleEmail = `throttle-test-${Date.now()}@checkpoint.local`;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: throttleEmail, password: 'WrongPassword!' }),
      });
      assert.strictEqual(res.status, 401, `Attempt ${i + 1} should be 401`);
    }

    // 6th attempt should be blocked by LoginThrottleGuard with 429
    const blockedRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: throttleEmail, password: 'WrongPassword!' }),
    });
    assert.strictEqual(blockedRes.status, 429, '6th attempt must return 429 Too Many Requests');
    console.log('  ✅ Login rate limiting triggered on 6th attempt (429 Too Many Requests)');

    console.log('\n🎉 ALL RBAC & THROTTLING TESTS PASSED WITH 100% SUCCESS!');
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

runRbacVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
