/**
 * REQ-028: every admin mutation and security-relevant event is recorded (who, what, when, which company),
 * never with secrets, only by the transaction that did the work, and the log cannot be edited afterwards.
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

describe('Audit events (e2e)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer();
  const A = { companyId: '', adminId: '', token: '', email: `admin-a-${run}@audit.test` };
  const B = { companyId: '', token: '', email: `admin-b-${run}@audit.test` };

  const events = async (token: string, query = '') =>
    (await request(http()).get(`/api/admin/audit-events${query}`).set('Authorization', `Bearer ${token}`).expect(200)).body;

  beforeAll(async () => {
    const a = await provisionCompany(prisma, { name: `Audit A ${run}`, slug: `audit-a-${run}`, adminEmail: A.email, adminPassword: PASSWORD, mustChangePassword: false });
    const b = await provisionCompany(prisma, { name: `Audit B ${run}`, slug: `audit-b-${run}`, adminEmail: B.email, adminPassword: PASSWORD, mustChangePassword: false });
    A.companyId = a.companyId; A.adminId = a.adminUserId; B.companyId = b.companyId;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    A.token = (await request(http()).post('/api/auth/login').send({ email: A.email, password: PASSWORD }).expect(200)).body.accessToken;
    B.token = (await request(http()).post('/api/auth/login').send({ email: B.email, password: PASSWORD }).expect(200)).body.accessToken;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('records the company provisioning as a system event', async () => {
    const res = await events(A.token, '?action=company.provision');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toEqual(expect.objectContaining({ actorType: 'SYSTEM', targetType: 'company', targetId: A.companyId }));
  });

  describe('admin mutations', () => {
    let userId: string;

    it('user.create names the actor and the target, and never contains a secret', async () => {
      const created = await request(http())
        .post('/api/admin/users').set('Authorization', `Bearer ${A.token}`)
        .send({ email: `emp-${run}@audit.test`, fullName: 'Emp', employeeCode: `AUD-${run}`, password: PASSWORD, roleCode: 'EMPLOYEE', initialSalary: 9000 })
        .expect(201);
      userId = created.body.id;

      const res = await events(A.token, `?action=user.create&targetId=${userId}`);
      expect(res.data).toHaveLength(1);
      const event = res.data[0];
      expect(event).toEqual(expect.objectContaining({ actorUserId: A.adminId, actorType: 'ADMIN', targetType: 'user', targetId: userId }));
      expect(event.changes).toEqual(expect.objectContaining({ email: `emp-${run}@audit.test`, role: 'EMPLOYEE' }));
      const text = JSON.stringify(res.data);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toMatch(/passwordHash|argon2/i);
    });

    it('a failed action leaves no audit event behind', async () => {
      const before = (await events(A.token, '?action=user.create')).total;
      await request(http())
        .post('/api/admin/users').set('Authorization', `Bearer ${A.token}`)
        .send({ email: `emp-${run}@audit.test`, fullName: 'Dup', employeeCode: `AUD-DUP-${run}`, password: PASSWORD, roleCode: 'EMPLOYEE' })
        .expect(409);
      expect((await events(A.token, '?action=user.create')).total).toBe(before);
    });

    it('records salary, deactivation and reactivation with before/after', async () => {
      await request(http()).post(`/api/admin/users/${userId}/salaries`).set('Authorization', `Bearer ${A.token}`).send({ amount: 11000, effectiveFrom: '2030-01-01' }).expect(201);
      await request(http()).patch(`/api/admin/users/${userId}/status`).set('Authorization', `Bearer ${A.token}`).send({ active: false }).expect(200);
      await request(http()).patch(`/api/admin/users/${userId}/status`).set('Authorization', `Bearer ${A.token}`).send({ active: true }).expect(200);

      const all = await events(A.token, `?targetId=${userId}&limit=50`);
      const actions = all.data.map((e: any) => e.action);
      expect(actions).toEqual(expect.arrayContaining(['user.create', 'salary.set', 'user.deactivate', 'user.activate']));
      const off = all.data.find((e: any) => e.action === 'user.deactivate');
      expect(off.changes).toEqual({ isActive: { from: true, to: false } });
    });

    it('records invitation create, revoke and accept', async () => {
      const mk = async (email: string, code: string) =>
        (await request(http()).post('/api/admin/invitations').set('Authorization', `Bearer ${A.token}`).send({ email, fullName: 'I', employeeCode: code }).expect(201)).body;

      const revoked = await mk(`rev-${run}@audit.test`, `REV-${run}`);
      await request(http()).delete(`/api/admin/invitations/${revoked.id}`).set('Authorization', `Bearer ${A.token}`).expect(200);
      const accepted = await mk(`acc-${run}@audit.test`, `ACC-${run}`);
      await request(http()).post('/api/auth/invitations/accept').send({ token: accepted.token, password: PASSWORD }).expect(200);

      const log = JSON.stringify((await events(A.token, '?limit=100')).data);
      expect(log).toContain('invitation.create');
      expect(log).toContain('invitation.revoke');
      expect(log).toContain('invitation.accept');
      expect(log).not.toContain(accepted.token); // the one-time token never reaches the log
    });

    it('records a password change as a security event', async () => {
      const login = await request(http()).post('/api/auth/login').send({ email: `acc-${run}@audit.test`, password: PASSWORD }).expect(200);
      await request(http()).patch('/api/me/password').set('Authorization', `Bearer ${login.body.accessToken}`).send({ currentPassword: PASSWORD, newPassword: 'Changed#Pass77' }).expect(200);

      const res = await events(A.token, '?action=password.change');
      expect(res.data).toHaveLength(1);
      expect(res.data[0].actorType).toBe('EMPLOYEE');
      expect(JSON.stringify(res.data)).not.toContain('Changed#Pass77');
    });
  });

  describe('access and integrity', () => {
    it('another company sees none of these events', async () => {
      const res = await events(B.token, '?limit=100');
      expect(res.data.every((e: any) => e.targetId !== A.companyId && e.actorUserId !== A.adminId)).toBe(true);
      expect(res.data.map((e: any) => e.action)).toEqual(['company.provision']);
    });

    it('an employee cannot read the log (403) and a stranger cannot either (401)', async () => {
      const login = await request(http()).post('/api/auth/login').send({ email: `emp-${run}@audit.test`, password: PASSWORD }).expect(200);
      // The employee was created by an Admin, so a password change is required first: still no access to the log.
      await request(http()).get('/api/admin/audit-events').set('Authorization', `Bearer ${login.body.accessToken}`).expect(403);
      await request(http()).get('/api/admin/audit-events').expect(401);
    });

    it('paginates newest first', async () => {
      const res = await events(A.token, '?limit=2&page=1');
      expect(res).toEqual(expect.objectContaining({ page: 1, limit: 2 }));
      expect(res.data).toHaveLength(2);
      expect(new Date(res.data[0].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(res.data[1].createdAt).getTime());
    });

    it('the database refuses to change or delete an event', async () => {
      const row = await prisma.auditEvent.findFirstOrThrow({ where: { companyId: A.companyId } });
      await expect(prisma.auditEvent.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/i);
      await expect(prisma.auditEvent.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/i);
      await expect(prisma.auditEvent.deleteMany({ where: { companyId: A.companyId } })).rejects.toThrow(/append-only/i);
    });
  });
});
