/**
 * Session security (HAS-151 hardening): atomic refresh rotation, immediate deactivation,
 * company binding of access tokens, failure-only login throttling, forced password change.
 * Needs a database with the current schema.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { sign } from 'jsonwebtoken';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { provisionCompany } from '../src/company/provision-company';

const prisma = new PrismaClient();
const run = Date.now();
const PASSWORD = 'Password123!';

describe('Session security (e2e)', () => {
  let app: INestApplication;
  let companyId: string;
  let adminToken: string;
  const http = () => app.getHttpServer();

  async function makeEmployee(label: string, mustChangePassword = false) {
    const email = `${label}-${run}@sec.test`;
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
    const shift = await prisma.shift.findFirstOrThrow({ where: { companyId } });
    const user = await prisma.user.create({
      data: { companyId, email, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), mustChangePassword },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    await prisma.employee.create({
      data: { companyId, userId: user.id, employeeNumber: `SEC-${label}-${run}`, fullName: label, currentShiftId: shift.id },
    });
    return { id: user.id, email };
  }

  const login = (email: string, password = PASSWORD) => request(http()).post('/api/auth/login').send({ email, password });

  beforeAll(async () => {
    const result = await provisionCompany(prisma, {
      name: `Sec ${run}`, slug: `sec-${run}`, adminEmail: `admin-${run}@sec.test`,
      adminPassword: PASSWORD, mustChangePassword: false,
    });
    companyId = result.companyId;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    adminToken = (await login(`admin-${run}@sec.test`).expect(200)).body.accessToken;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  describe('refresh rotation is atomic', () => {
    it('two simultaneous refreshes with the same token: exactly one wins, the loser is treated as reuse and the family dies', async () => {
      const emp = await makeEmployee('race');
      const { refreshToken } = (await login(emp.email).expect(200)).body;

      const [r1, r2] = await Promise.all([
        request(http()).post('/api/auth/refresh').send({ refreshToken }),
        request(http()).post('/api/auth/refresh').send({ refreshToken }),
      ]);

      expect([r1.status, r2.status].sort()).toEqual([200, 401]);

      // The loser revoked the whole family, so the winner's brand-new token is dead too.
      const winner = r1.status === 200 ? r1 : r2;
      await request(http()).post('/api/auth/refresh').send({ refreshToken: winner.body.refreshToken }).expect(401);
    });

    it('a normal rotation links the old token to the new one', async () => {
      const emp = await makeEmployee('chain');
      const { refreshToken } = (await login(emp.email).expect(200)).body;

      const next = await request(http()).post('/api/auth/refresh').send({ refreshToken }).expect(200);

      const crypto = await import('crypto');
      const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
      const old = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hash(refreshToken) } });
      const fresh = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hash(next.body.refreshToken) } });
      expect(old.revokedAt).not.toBeNull();
      expect(old.replacedBy).toBe(fresh.id);
      expect(fresh.revokedAt).toBeNull();
    });
  });

  describe('access tokens are checked against the account', () => {
    it('a deactivated user\'s access token stops working immediately', async () => {
      const emp = await makeEmployee('deactivated');
      const { accessToken } = (await login(emp.email).expect(200)).body;
      await request(http()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);

      await request(http()).patch(`/api/admin/users/${emp.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ active: false }).expect(200);

      await request(http()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
    });

    it('a validly signed token whose companyId is not the account\'s company is rejected (AC-REQ-006-07)', async () => {
      const emp = await makeEmployee('forged');
      const forged = sign(
        { sub: emp.id, companyId: '00000000-0000-4000-8000-000000000000', email: emp.email, role: 'EMPLOYEE', permissions: [] },
        process.env.JWT_ACCESS_SECRET as string,
        { expiresIn: '5m' },
      );

      await request(http()).get('/api/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
    });
  });

  describe('login throttling counts failures only', () => {
    it('many successful sign-ins never lock a real user out', async () => {
      const emp = await makeEmployee('happy');
      for (let i = 0; i < 7; i++) {
        await login(emp.email).expect(200);
      }
    });

    it('after 5 wrong passwords even the correct one is refused (429) until the window passes', async () => {
      const emp = await makeEmployee('brute');
      for (let i = 0; i < 5; i++) {
        await login(emp.email, 'wrong-password').expect(401);
      }
      await login(emp.email).expect(429);
    });

    it('a successful sign-in resets the failure count', async () => {
      const emp = await makeEmployee('reset');
      for (let i = 0; i < 4; i++) await login(emp.email, 'wrong-password').expect(401);
      await login(emp.email).expect(200);
      for (let i = 0; i < 4; i++) await login(emp.email, 'wrong-password').expect(401);
      await login(emp.email).expect(200);
    });
  });

  describe('forced password change (provisioned or admin-created accounts)', () => {
    const NEW_PASSWORD = 'BrandNew#Pass9';

    it('blocks everything except /auth/me and the password change until the one-time password is replaced', async () => {
      const emp = await makeEmployee('onetime', true);
      const first = await login(emp.email).expect(200);
      expect(first.body.user.mustChangePassword).toBe(true);
      const auth = { Authorization: `Bearer ${first.body.accessToken}` };

      // Blocked, with a machine-readable code
      const blocked = await request(http()).get('/api/me/profile').set(auth).expect(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      await request(http()).get('/api/admin/users').set(auth).expect(403);
      // Allowed while blocked
      await request(http()).get('/api/auth/me').set(auth).expect(200);

      // Validation: wrong current, same password, too short
      await request(http()).patch('/api/me/password').set(auth).send({ currentPassword: 'not-it', newPassword: NEW_PASSWORD }).expect(400);
      await request(http()).patch('/api/me/password').set(auth).send({ currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
      await request(http()).patch('/api/me/password').set(auth).send({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400);

      await request(http()).patch('/api/me/password').set(auth).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);

      // Every session was ended; the old password is gone; the new one works and the flag is cleared
      await request(http()).post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
      await login(emp.email, PASSWORD).expect(401);
      const second = await login(emp.email, NEW_PASSWORD).expect(200);
      expect(second.body.user.mustChangePassword).toBe(false);
      await request(http()).get('/api/me/profile').set('Authorization', `Bearer ${second.body.accessToken}`).expect(200);
    });

    it('a user who is not required to change can still change voluntarily', async () => {
      const emp = await makeEmployee('voluntary');
      const { accessToken } = (await login(emp.email).expect(200)).body;
      await request(http()).patch('/api/me/password').set('Authorization', `Bearer ${accessToken}`).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);
      await login(emp.email, NEW_PASSWORD).expect(200);
    });

    it('requires a token', () => request(http()).patch('/api/me/password').send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(401));
  });
});
