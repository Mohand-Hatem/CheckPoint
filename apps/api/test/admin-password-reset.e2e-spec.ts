/**
 * FR-AUTH-5 admin password reset, and the Phase 1 DoD proof that an admin mutation and its audit row
 * share one transaction: a forced failure after the audit insert leaves no audit row and no data change.
 * Needs a database with the current schema (see README). Creates a fresh company per run.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { provisionCompany } from '../src/company/provision-company';

const prisma = new PrismaClient();
const run = Date.now();
const PASSWORD = 'Password123!';
const TEMP = 'Temp-Pass-2026';

describe('Admin password reset (e2e, FR-AUTH-5)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userId: string;
  const email = `reset-emp-${run}@reset.test`;

  const http = () => request(app.getHttpServer());
  const login = (password: string) => http().post('/api/auth/login').send({ email, password });
  const reset = () =>
    http()
      .post(`/api/admin/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: TEMP });

  beforeAll(async () => {
    const admin = `reset-admin-${run}@reset.test`;
    await provisionCompany(prisma, {
      name: `Reset ${run}`,
      slug: `reset-${run}`,
      adminEmail: admin,
      adminPassword: PASSWORD,
      employeeNumber: 'ADMIN-001',
      mustChangePassword: false,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    adminToken = (await http().post('/api/auth/login').send({ email: admin, password: PASSWORD }).expect(200)).body.accessToken;
    userId = (
      await http()
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email, fullName: 'Reset Emp', employeeCode: `RST-${run}`, password: PASSWORD, roleCode: 'EMPLOYEE' })
        .expect(201)
    ).body.id;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('a failure after the audit insert rolls back the audit row and the reset itself', async () => {
    const session = (await login(PASSWORD).expect(200)).body;
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const audit = app.get(AuditService);
    const realRecord = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementationOnce((async (tx: never, entry: never) => {
      await realRecord(tx, entry);
      throw new Error('forced failure after the audit insert');
    }) as never);

    await reset().expect(500);
    spy.mockRestore();

    expect(await prisma.auditEvent.count({ where: { action: 'user.password_reset', targetId: userId } })).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.mustChangePassword).toBe(before.mustChangePassword);
    await http().post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(200);
  });

  it('resets the password, forces a change and ends every session', async () => {
    const session = (await login(PASSWORD).expect(200)).body;

    const res = await reset().expect(200);
    expect(res.body).toMatchObject({ success: true, mustChangePassword: true });
    expect(res.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

    await http().post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    await login(PASSWORD).expect(401);
    const fresh = await login(TEMP).expect(200);
    expect(fresh.body.user.mustChangePassword).toBe(true);

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'user.password_reset', targetId: userId } });
    expect(JSON.stringify(audit)).not.toContain(TEMP);
  });

  it('refuses a reset without users.write, and an Admin resetting their own password', async () => {
    const employeeToken = (await login(TEMP).expect(200)).body.accessToken;
    await http()
      .post(`/api/admin/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ password: TEMP })
      .expect(403);

    const adminId = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64url').toString()).sub;
    await http()
      .post(`/api/admin/users/${adminId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: TEMP })
      .expect(400);
  });
});
