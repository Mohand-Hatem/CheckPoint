import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as assert from 'assert';
import { AppModule } from '../src/app.module';

async function runVerification() {
  console.log('🧪 Starting AuthService automated verification...');
  const app = await NestFactory.create(AppModule, { logger: false });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = 4099;
  await app.listen(port);
  const baseUrl = `http://localhost:${port}/api`;

  try {
    // 1. Invalid login test
    console.log('  Testing invalid password rejection...');
    const invalidLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@checkpoint.local',
        password: 'WrongPassword!',
      }),
    });
    assert.strictEqual(invalidLoginRes.status, 401, 'Should reject invalid password with 401');
    console.log('  ✅ Invalid password correctly rejected (401)');

    // 2. Valid login test
    console.log('  Testing valid admin login...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@checkpoint.local',
        password: 'AdminPassword123!',
      }),
    });
    assert.strictEqual(loginRes.status, 200, 'Should accept valid login with 200');
    const loginData = await loginRes.json();
    assert.ok(loginData.accessToken, 'Should return access token');
    assert.ok(loginData.refreshToken, 'Should return refresh token');
    assert.strictEqual(loginData.user.email, 'admin@checkpoint.local');
    assert.strictEqual(loginData.user.role, 'ADMIN');
    console.log('  ✅ Valid login accepted (200), tokens issued');

    const token1 = loginData.refreshToken;

    // 3. Normal token rotation test
    console.log('  Testing token rotation...');
    const refreshRes1 = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token1 }),
    });
    assert.strictEqual(refreshRes1.status, 200, 'Should rotate token successfully');
    const refreshData1 = await refreshRes1.json();
    assert.ok(refreshData1.accessToken, 'Should return new access token');
    assert.ok(refreshData1.refreshToken, 'Should return new rotated refresh token');
    assert.notStrictEqual(refreshData1.refreshToken, token1, 'Rotated token must differ');
    console.log('  ✅ Token rotated successfully (200)');

    const token2 = refreshData1.refreshToken;

    // 4. Theft / Reuse detection test
    console.log('  Testing reuse detection (theft scenario)...');
    // Reusing spent token1
    const reuseRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token1 }),
    });
    assert.strictEqual(reuseRes.status, 401, 'Reused token must be rejected with 401');
    const reuseData = await reuseRes.json();
    assert.ok(
      reuseData.message.includes('reuse detected'),
      'Message should indicate reuse detection',
    );
    console.log('  ✅ Spent token reuse detected and rejected (401)');

    // Confirm that the entire family (including token2) was burned
    console.log('  Verifying entire token family was revoked...');
    const familyBurnedRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token2 }),
    });
    assert.strictEqual(familyBurnedRes.status, 401, 'Burned family token must be rejected');
    console.log('  ✅ Sibling token in family also revoked (401)');

    // 5. Logout test
    console.log('  Testing logout...');
    const loginRes2 = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@checkpoint.local',
        password: 'AdminPassword123!',
      }),
    });
    const { refreshToken: token3 } = await loginRes2.json();

    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token3 }),
    });
    assert.strictEqual(logoutRes.status, 200, 'Logout should return 200');

    const afterLogoutRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token3 }),
    });
    assert.strictEqual(afterLogoutRefresh.status, 401, 'Logged out token must be rejected');
    console.log('  ✅ Logout revoked session successfully (200 -> 401)');

    console.log('\n🎉 ALL AUTHENTICATION TESTS PASSED WITH 100% SUCCESS!');
  } finally {
    await app.close();
  }
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
