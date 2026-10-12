import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as assert from 'assert';
import { AppModule } from '../src/app.module';

async function runUsersVerification() {
  console.log('🧪 Starting Users & Versioned Salaries automated verification...');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = 4097;
  await app.listen(port);
  const baseUrl = `http://localhost:${port}/api`;

  try {
    // 1. Admin login to get bearer token
    console.log('  Logging in as Admin...');
    const adminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@checkpoint.local',
        password: 'AdminPassword123!',
      }),
    });
    const { accessToken: adminToken } = await adminLoginRes.json();
    assert.ok(adminToken, 'Admin token required');
    const authHeaders = {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    };

    // 2. Create User with Initial Salary
    console.log('  Testing user creation with initial salary...');
    const uniqueEmail = `testuser-${Date.now()}@checkpoint.local`;
    const uniqueCode = `EMP-${Date.now().toString().slice(-4)}`;
    const createRes = await fetch(`${baseUrl}/admin/users`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        email: uniqueEmail,
        fullName: 'Test Developer',
        password: 'DevPassword123!',
        employeeCode: uniqueCode,
        roleCode: 'EMPLOYEE',
        initialSalary: 12500,
        currency: 'EGP',
      }),
    });
    assert.strictEqual(createRes.status, 201, 'Should create user with 201');
    const createdUser = await createRes.json();
    assert.strictEqual(createdUser.email, uniqueEmail);
    assert.strictEqual(createdUser.role.code, 'EMPLOYEE');
    console.log(`  ✅ User created successfully: ${createdUser.id}`);

    const userId = createdUser.id;

    // 3. Query paginated users
    console.log('  Testing paginated users list & search...');
    const listRes = await fetch(`${baseUrl}/admin/users?search=${uniqueCode}`, {
      headers: authHeaders,
    });
    assert.strictEqual(listRes.status, 200, 'Should return users list');
    const listData = await listRes.json();
    assert.strictEqual(listData.total, 1, 'Should find 1 user by unique code');
    assert.strictEqual(listData.data[0].currentSalary.amount, '12500');
    console.log('  ✅ Paginated query and salary embedding verified');

    // 4. Test versioned salary addition: Non-1st of month rejection
    console.log('  Testing salary validation: rejecting non-1st of month...');
    const invalidDateRes = await fetch(`${baseUrl}/admin/users/${userId}/salaries`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        amount: 14000,
        effectiveFrom: '2026-11-15',
      }),
    });
    assert.strictEqual(invalidDateRes.status, 400, 'Non-1st date must be rejected with 400');
    console.log('  ✅ Non-1st day rejected with 400 Bad Request');

    // 5. Test versioned salary addition: 1st of month acceptance
    console.log('  Testing salary validation: accepting 1st of month...');
    const validSalaryRes = await fetch(`${baseUrl}/admin/users/${userId}/salaries`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        amount: 14500,
        effectiveFrom: '2026-11-01',
      }),
    });
    assert.strictEqual(validSalaryRes.status, 201, '1st of month salary must succeed with 201');
    const salaryData = await validSalaryRes.json();
    assert.strictEqual(salaryData.amount, '14500');
    console.log('  ✅ New salary version created (14,500 effective 2026-11-01)');

    // 6. Verify user details contain salary history
    console.log('  Testing user details with salary history...');
    const detailsRes = await fetch(`${baseUrl}/admin/users/${userId}`, {
      headers: authHeaders,
    });
    assert.strictEqual(detailsRes.status, 200);
    const details = await detailsRes.json();
    assert.strictEqual(details.salaries.length, 2, 'Should have 2 salary versions');
    console.log('  ✅ Salary version history preserved accurately (2 versions)');

    // 7. Test deactivation and immediate token purge
    console.log('  Logging in as the new user to test deactivation revoke...');
    const userLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail,
        password: 'DevPassword123!',
      }),
    });
    assert.strictEqual(userLoginRes.status, 200);
    const { refreshToken: userRefreshToken } = await userLoginRes.json();

    console.log('  Deactivating user account...');
    const deactiveRes = await fetch(`${baseUrl}/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ active: false }),
    });
    assert.strictEqual(deactiveRes.status, 200);
    const deactData = await deactiveRes.json();
    assert.strictEqual(deactData.active, false);

    console.log('  Verifying refresh token is rejected after deactivation...');
    const afterDeactRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: userRefreshToken }),
    });
    assert.strictEqual(
      afterDeactRefresh.status,
      401,
      'Refresh after deactivation must be rejected with 401',
    );
    console.log('  ✅ Session immediately revoked upon user deactivation');

    // 8. Verify login is blocked for deactivated user
    const blockedLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail,
        password: 'DevPassword123!',
      }),
    });
    assert.strictEqual(blockedLogin.status, 401, 'Deactivated login must be 401');
    console.log('  ✅ Deactivated account blocked from logging in (401)');

    console.log('\n🎉 ALL USERS & VERSIONED SALARIES TESTS PASSED WITH 100% SUCCESS!');
  } finally {
    await app.close();
  }
}

runUsersVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
