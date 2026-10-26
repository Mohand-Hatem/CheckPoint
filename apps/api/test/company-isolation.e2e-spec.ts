/**
 * Spec v0.4.0: REQ-031 (provisioning), REQ-032 (invitations), REQ-033 (company isolation),
 * AC-REQ-001-02, AC-REQ-006-07/08. Planning tests TEST-038, TEST-039, TEST-040.
 * Needs a database with the current schema (see README). Creates two fresh companies per run.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { provisionCompany } from '../src/company/provision-company';

const prisma = new PrismaClient();
const run = Date.now();
const PASSWORD = 'Password123!';

const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

describe('Company isolation, provisioning and invitations (e2e)', () => {
  let app: INestApplication;
  let http: () => any;

  const A = { slug: `iso-a-${run}`, admin: `admin-a-${run}@a.test`, companyId: '', token: '', refresh: '' };
  const B = { slug: `iso-b-${run}`, admin: `admin-b-${run}@b.test`, companyId: '', token: '', refresh: '' };
  let bUserId: string; // an employee that belongs to company B
  let aEmployee: { userId: string; token: string; refresh: string; email: string };

  async function login(email: string, password = PASSWORD) {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  }

  beforeAll(async () => {
    for (const c of [A, B]) {
      const result = await provisionCompany(prisma, {
        name: `Isolation ${c.slug}`,
        slug: c.slug,
        adminEmail: c.admin,
        adminPassword: PASSWORD,
        employeeNumber: 'ADMIN-001',
        // A real Admin has already replaced the one-time password; session-security.e2e-spec covers that flow.
        mustChangePassword: false,
      });
      c.companyId = result.companyId;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    http = () => app.getHttpServer();

    for (const c of [A, B]) {
      const tokens = await login(c.admin);
      c.token = tokens.accessToken;
      c.refresh = tokens.refreshToken;
    }
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  describe('provisioning (REQ-031, TEST-038)', () => {
    it('the first Admin signs in and the session is bound to its company', () => {
      expect(claims(A.token).companyId).toBe(A.companyId);
      expect(claims(B.token).companyId).toBe(B.companyId);
      expect(claims(A.token).role).toBe('ADMIN');
    });

    it('exposes no public route to create a company', async () => {
      for (const path of ['/api/companies', '/api/auth/register', '/api/admin/companies']) {
        const res = await request(http()).post(path).send({ name: 'x', slug: 'x-company' });
        expect([401, 404]).toContain(res.status); // never 200/201
      }
    });

    it('is all-or-nothing: a duplicate slug creates no company, user or settings', async () => {
      // Scoped to what each attempt would create: other suites run in parallel against the same database.
      const settingsBefore = await prisma.setting.count({ where: { companyId: A.companyId } });

      await expect(
        provisionCompany(prisma, { name: 'Dup', slug: A.slug, adminEmail: `dup-${run}@dup.test`, adminPassword: PASSWORD }),
      ).rejects.toThrow(/already exists/);
      expect(await prisma.user.count({ where: { email: `dup-${run}@dup.test` } })).toBe(0);
      expect(await prisma.company.count({ where: { slug: A.slug } })).toBe(1);
      expect(await prisma.setting.count({ where: { companyId: A.companyId } })).toBe(settingsBefore);

      // Fails late (admin email taken) after the company, settings and shift were already written in the transaction.
      await expect(
        provisionCompany(prisma, { name: 'Dup2', slug: `fresh-${run}`, adminEmail: A.admin, adminPassword: PASSWORD }),
      ).rejects.toThrow(/already exists/);
      expect(await prisma.company.count({ where: { slug: `fresh-${run}` } })).toBe(0);
      expect(await prisma.shift.count({ where: { company: { slug: `fresh-${run}` } } })).toBe(0);
    });
  });

  describe('company isolation (REQ-033, TEST-040)', () => {
    it('each Admin creates an employee in their own company', async () => {
      const a = await request(http())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${A.token}`)
        .send({ email: `emp-a-${run}@a.test`, fullName: 'Emp A', employeeCode: 'EMP-1', password: PASSWORD, roleCode: 'EMPLOYEE', initialSalary: 9000 })
        .expect(201);
      const b = await request(http())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${B.token}`)
        .send({ email: `emp-b-${run}@b.test`, fullName: 'Emp B', employeeCode: 'EMP-1', password: PASSWORD, roleCode: 'EMPLOYEE' })
        .expect(201); // same employee code in two companies is allowed
      bUserId = b.body.id;

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: a.body.id } });
      expect(dbUser.companyId).toBe(A.companyId);
    });

    it('A cannot read B\'s user: 404, indistinguishable from a missing id', async () => {
      const foreign = await request(http()).get(`/api/admin/users/${bUserId}`).set('Authorization', `Bearer ${A.token}`);
      const missing = await request(http())
        .get('/api/admin/users/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${A.token}`);

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.body.message.replace(bUserId, 'ID')).toBe(missing.body.message.replace('00000000-0000-4000-8000-000000000000', 'ID'));
    });

    it('A\'s user list never contains B\'s users', async () => {
      const res = await request(http()).get('/api/admin/users?limit=100').set('Authorization', `Bearer ${A.token}`).expect(200);
      const emails: string[] = res.body.data.map((u: any) => u.email);
      expect(emails).toContain(A.admin);
      expect(emails.some((e) => e.endsWith('@b.test'))).toBe(false);
    });

    it('A cannot change B\'s user status or salary, and nothing changes', async () => {
      await request(http()).patch(`/api/admin/users/${bUserId}/status`).set('Authorization', `Bearer ${A.token}`).send({ active: false }).expect(404);
      await request(http())
        .post(`/api/admin/users/${bUserId}/salaries`)
        .set('Authorization', `Bearer ${A.token}`)
        .send({ amount: 1, effectiveFrom: '2026-11-01' })
        .expect(404);

      const b = await prisma.user.findUniqueOrThrow({ where: { id: bUserId } });
      expect(b.isActive).toBe(true);
      expect(await prisma.employeeSalaryVersion.count({ where: { employee: { userId: bUserId } } })).toBe(0);
    });

    it('a refresh keeps the account\'s company and cannot switch it (AC-REQ-006-07/08)', async () => {
      const res = await request(http()).post('/api/auth/refresh').send({ refreshToken: A.refresh }).expect(200);
      expect(claims(res.body.accessToken).companyId).toBe(A.companyId);

      const bRes = await request(http()).post('/api/auth/refresh').send({ refreshToken: B.refresh }).expect(200);
      expect(claims(bRes.body.accessToken).companyId).toBe(B.companyId);
    });

    it('a token without a companyId is rejected', async () => {
      const { sign } = await import('jsonwebtoken');
      const secret = process.env.JWT_ACCESS_SECRET as string;
      const legacy = sign({ sub: 'x', email: 'x@x.test', role: 'ADMIN', permissions: ['*'] }, secret, { expiresIn: '5m' });

      await request(http()).get('/api/admin/users').set('Authorization', `Bearer ${legacy}`).expect(401);
    });
  });

  describe('invitations (REQ-032, TEST-039)', () => {
    let invitationId: string;
    let inviteToken: string;
    const inviteeEmail = `invitee-${run}@a.test`;

    it('A\'s Admin invites an employee: the response has the token once; the database has only its hash', async () => {
      const res = await request(http())
        .post('/api/admin/invitations')
        .set('Authorization', `Bearer ${A.token}`)
        .send({ email: inviteeEmail, fullName: 'Invitee', employeeCode: 'INV-1' })
        .expect(201);

      invitationId = res.body.id;
      inviteToken = res.body.token;
      expect(inviteToken).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body).not.toHaveProperty('tokenHash');

      const row = await prisma.companyInvitation.findUniqueOrThrow({ where: { id: invitationId } });
      expect(row.companyId).toBe(A.companyId);
      expect(row.tokenHash).not.toBe(inviteToken);
      expect(Object.values(row)).not.toContain(inviteToken);
    });

    it('rejects a second pending invitation for the same email', () =>
      request(http())
        .post('/api/admin/invitations')
        .set('Authorization', `Bearer ${A.token}`)
        .send({ email: inviteeEmail, fullName: 'Again', employeeCode: 'INV-2' })
        .expect(409));

    it('two simultaneous invitations for one email: exactly one is created, the other is a clean 409', async () => {
      const body = { email: `race-${run}@a.test`, fullName: 'Race', employeeCode: `RACE-${run}` };
      const send = () => request(http()).post('/api/admin/invitations').set('Authorization', `Bearer ${A.token}`).send(body);

      const [first, second] = await Promise.all([send(), send()]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      expect(await prisma.companyInvitation.count({ where: { companyId: A.companyId, email: body.email, status: 'PENDING' } })).toBe(1);
    });

    it('B\'s Admin can neither list nor revoke A\'s invitation', async () => {
      const list = await request(http()).get('/api/admin/invitations').set('Authorization', `Bearer ${B.token}`).expect(200);
      expect(list.body.map((i: any) => i.id)).not.toContain(invitationId);
      await request(http()).delete(`/api/admin/invitations/${invitationId}`).set('Authorization', `Bearer ${B.token}`).expect(404);
    });

    it('an unknown token cannot be accepted', () =>
      request(http()).post('/api/auth/invitations/accept').send({ token: 'f'.repeat(64), password: PASSWORD }).expect(400));

    it('accepting creates the account inside the inviter\'s company; the new employee signs in bound to it', async () => {
      await request(http()).post('/api/auth/invitations/accept').send({ token: inviteToken, password: PASSWORD }).expect(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: inviteeEmail }, include: { employee: true, roles: { include: { role: true } } } });
      expect(user.companyId).toBe(A.companyId);
      expect(user.employee?.companyId).toBe(A.companyId);
      expect(user.employee?.employeeNumber).toBe('INV-1');
      expect(user.roles.map((r) => r.role.name)).toEqual(['EMPLOYEE']);

      const tokens = await login(inviteeEmail);
      expect(claims(tokens.accessToken).companyId).toBe(A.companyId);
      aEmployee = { userId: user.id, token: tokens.accessToken, refresh: tokens.refreshToken, email: inviteeEmail };
    });

    it('is single-use: the same token cannot be accepted twice', () =>
      request(http()).post('/api/auth/invitations/accept').send({ token: inviteToken, password: PASSWORD }).expect(400));

    it('an expired or revoked invitation cannot be accepted', async () => {
      const mk = async (email: string, code: string) =>
        (await request(http()).post('/api/admin/invitations').set('Authorization', `Bearer ${A.token}`).send({ email, fullName: 'X', employeeCode: code }).expect(201)).body;

      const expired = await mk(`expired-${run}@a.test`, 'INV-E');
      await prisma.companyInvitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await request(http()).post('/api/auth/invitations/accept').send({ token: expired.token, password: PASSWORD }).expect(400);

      const revoked = await mk(`revoked-${run}@a.test`, 'INV-R');
      await request(http()).delete(`/api/admin/invitations/${revoked.id}`).set('Authorization', `Bearer ${A.token}`).expect(200);
      await request(http()).post('/api/auth/invitations/accept').send({ token: revoked.token, password: PASSWORD }).expect(400);

      expect(await prisma.user.count({ where: { email: { in: [`expired-${run}@a.test`, `revoked-${run}@a.test`] } } })).toBe(0);
    });
  });

  describe('employees are limited (AC-REQ-001-02, ADMIN-only mutations)', () => {
    it('an employee is rejected (403) on every ADMIN-only mutation and on reading another user', async () => {
      const auth = { Authorization: `Bearer ${aEmployee.token}` };
      const other = bUserId;

      await request(http()).post('/api/admin/users').set(auth).send({ email: `x-${run}@a.test`, fullName: 'X', employeeCode: 'X-1', password: PASSWORD, roleCode: 'EMPLOYEE' }).expect(403);
      await request(http()).patch(`/api/admin/users/${other}/status`).set(auth).send({ active: false }).expect(403);
      await request(http()).post(`/api/admin/users/${other}/salaries`).set(auth).send({ amount: 1, effectiveFrom: '2026-11-01' }).expect(403);
      await request(http()).get(`/api/admin/users/${other}`).set(auth).expect(403);
      await request(http()).post('/api/admin/invitations').set(auth).send({ email: `y-${run}@a.test`, fullName: 'Y', employeeCode: 'Y-1' }).expect(403);
      await request(http()).delete('/api/admin/invitations/00000000-0000-4000-8000-000000000000').set(auth).expect(403);
    });

    it('GET /me/profile returns only the caller\'s own record; no parameter can select another', async () => {
      const own = await request(http()).get('/api/me/profile').set('Authorization', `Bearer ${aEmployee.token}`).expect(200);
      expect(own.body.email).toBe(aEmployee.email);
      expect(own.body.role).toBe('EMPLOYEE');
      expect(own.body).not.toHaveProperty('salaries');

      // Another user's id in the query string is ignored: the answer is still the caller's own record.
      const spoof = await request(http())
        .get(`/api/me/profile?id=${bUserId}&userId=${bUserId}`)
        .set('Authorization', `Bearer ${aEmployee.token}`)
        .expect(200);
      expect(spoof.body.id).toBe(own.body.id);

      // The Admin gets the Admin's own record, not the employee's.
      const admin = await request(http()).get('/api/me/profile').set('Authorization', `Bearer ${A.token}`).expect(200);
      expect(admin.body.email).toBe(A.admin);
      expect(admin.body.role).toBe('ADMIN');
    });

    it('unauthenticated requests are rejected on every protected route (401)', async () => {
      await request(http()).get('/api/me/profile').expect(401);
      await request(http()).get('/api/admin/users').expect(401);
      await request(http()).post('/api/admin/invitations').send({}).expect(401);
      await request(http()).get('/api/auth/me').expect(401);
    });

    it('deactivating a user ends their sessions', async () => {
      await request(http()).patch(`/api/admin/users/${aEmployee.userId}/status`).set('Authorization', `Bearer ${A.token}`).send({ active: false }).expect(200);
      await request(http()).post('/api/auth/refresh').send({ refreshToken: aEmployee.refresh }).expect(401);
    });
  });
});
