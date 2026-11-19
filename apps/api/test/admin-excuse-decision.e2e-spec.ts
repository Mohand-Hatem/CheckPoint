/**
 * Admin decision on attendance excuses (REQ-035, ticket HAS-170, 05 §4.8) through the real API.
 * Needs `prisma migrate deploy`.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PointType } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { provisionCompany } from '../src/company/provision-company';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const run = Date.now();
const PASSWORD = 'Password123!';
const MISSING = '00000000-0000-4000-8000-000000000000';

describe('Admin excuse decision (e2e, REQ-035)', () => {
  let app: INestApplication;
  let companyId: string;
  let adminUserId: string;
  let adminToken: string;
  let employeeToken: string;
  let employeeUserId: string;
  let otherAdminToken: string;
  const excuse = { approve: '', repeat: '', race: '', own: '' };

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (email: string) =>
    (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;
  const decide = (token: string, id: string, body: object = { decision: 'APPROVED', decisionReason: 'Reviewed the employee explanation.' }) =>
    http().post(`/api/admin/attendance-excuses/${id}/decision`).set(auth(token)).send(body);
  const makeDay = async (employeeId: string, workDate: string) =>
    (await prisma.attendanceDay.create({
      data: {
        companyId, employeeId, workDate: new Date(`${workDate}T00:00:00.000Z`), timezone: 'Africa/Cairo',
        scheduledStartAt: new Date(`${workDate}T06:00:00Z`), earlyEndAt: new Date(`${workDate}T07:00:00Z`),
        graceEndAt: new Date(`${workDate}T08:00:00Z`), redPeriodEndAt: new Date(`${workDate}T10:00:00Z`),
        scheduledEndAt: new Date(`${workDate}T14:00:00Z`), checkInAt: new Date(`${workDate}T09:00:00Z`),
        checkInResult: 'RED', classification: PointType.RED,
      },
    })).id;
  const submit = async (token: string, dayId: string) =>
    (await http().post(`/api/me/attendance/${dayId}/excuse`).set(auth(token)).send({ employeeReason: 'I was delayed by a transit disruption.' }).expect(201)).body.id as string;

  beforeAll(async () => {
    const adminEmail = `decide-${run}@dc.test`;
    ({ companyId, adminUserId } = await provisionCompany(prisma, {
      name: `Decide ${run}`, slug: `decide-${run}`, adminEmail, adminPassword: PASSWORD, mustChangePassword: false,
    }));
    const otherEmail = `decide-other-${run}@dc.test`;
    await provisionCompany(prisma, {
      name: `Decide other ${run}`, slug: `decide-other-${run}`, adminEmail: otherEmail, adminPassword: PASSWORD, mustChangePassword: false,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    adminToken = await login(adminEmail);
    otherAdminToken = await login(otherEmail);
    const employeeEmail = `decide-emp-${run}@dc.test`;
    employeeUserId = (
      await http().post('/api/admin/users').set(auth(adminToken))
        .send({ email: employeeEmail, fullName: 'Employee', employeeCode: `DC-${run}`, password: PASSWORD, roleCode: 'EMPLOYEE' })
        .expect(201)
    ).body.id;
    await prisma.user.update({ where: { id: employeeUserId }, data: { mustChangePassword: false } });
    employeeToken = await login(employeeEmail);

    const employeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: employeeUserId } })).id;
    const adminEmployeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: adminUserId } })).id;
    excuse.approve = await submit(employeeToken, await makeDay(employeeId, '2026-03-01'));
    excuse.repeat = await submit(employeeToken, await makeDay(employeeId, '2026-03-02'));
    excuse.race = await submit(employeeToken, await makeDay(employeeId, '2026-03-03'));
    excuse.own = await submit(adminToken, await makeDay(adminEmployeeId, '2026-03-01'));
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('AC-01: a user without attendance.write gets 403 and nothing changes', async () => {
    await decide(employeeToken, excuse.approve).expect(403);
    expect(await prisma.attendanceExcuse.findUniqueOrThrow({ where: { id: excuse.approve } })).toMatchObject({ status: 'PENDING' });
  });

  it('AC-02: only APPROVED or REJECTED with a non-empty reason', async () => {
    await decide(adminToken, excuse.approve, { decision: 'MAYBE', decisionReason: 'x' }).expect(400);
    await decide(adminToken, excuse.approve, { decision: 'PENDING', decisionReason: 'x' }).expect(400);
    await decide(adminToken, excuse.approve, { decision: 'APPROVED', decisionReason: '   ' }).expect(400);
    await decide(adminToken, excuse.approve, { decision: 'APPROVED' }).expect(400);
    await decide(adminToken, excuse.approve, { decision: 'APPROVED', decisionReason: 'x'.repeat(1001) }).expect(400);
    await decide(adminToken, 'not-a-uuid').expect(400);
  });

  it('AC-04/05: stores and audits the decision, without touching attendance or points', async () => {
    const before = await prisma.attendanceExcuse.findUniqueOrThrow({ where: { id: excuse.approve }, include: { attendanceDay: true } });
    const ledger = await prisma.pointLedgerEntry.count({ where: { companyId } });

    const body = (await decide(adminToken, excuse.approve, { decision: 'APPROVED', decisionReason: '  Reviewed the employee explanation.  ' }).expect(200)).body;

    expect(body).toEqual({
      id: excuse.approve, attendanceDayId: before.attendanceDayId, employeeReason: 'I was delayed by a transit disruption.',
      status: 'APPROVED', decisionReason: 'Reviewed the employee explanation.', submittedByUserId: employeeUserId,
      decidedByUserId: adminUserId, createdAt: before.createdAt.toISOString(), decidedAt: expect.any(String),
    });
    expect(await prisma.attendanceDay.findUniqueOrThrow({ where: { id: before.attendanceDayId } })).toEqual(before.attendanceDay);
    expect(await prisma.pointLedgerEntry.count({ where: { companyId } })).toBe(ledger);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { companyId, action: 'attendance_excuse.decide', targetId: excuse.approve } });
    expect(audit).toMatchObject({ actorUserId: adminUserId, actorType: 'ADMIN', reason: 'Reviewed the employee explanation.' });
    expect(audit.changes).toMatchObject({ before: { status: 'PENDING' }, after: { status: 'APPROVED' } });

    // The employee sees the decision (REQ-034).
    const mine = (await http().get(`/api/me/attendance-excuses/${excuse.approve}`).set(auth(employeeToken)).expect(200)).body;
    expect(mine).toMatchObject({ status: 'APPROVED', decisionReason: 'Reviewed the employee explanation.', decidedAt: body.decidedAt });
  });

  it('AC-03: a repeated decision answers 409 and keeps the first', async () => {
    await decide(adminToken, excuse.repeat, { decision: 'REJECTED', decisionReason: 'No evidence.' }).expect(200);
    const second = await decide(adminToken, excuse.repeat, { decision: 'APPROVED', decisionReason: 'Changed my mind.' }).expect(409);
    expect(second.body.code).toBe('EXCUSE_ALREADY_DECIDED');
    expect(await prisma.attendanceExcuse.findUniqueOrThrow({ where: { id: excuse.repeat } }))
      .toMatchObject({ status: 'REJECTED', decisionReason: 'No evidence.' });
  });

  it('AC-03: two concurrent decisions: one wins, the other gets 409', async () => {
    const results = await Promise.all([
      decide(adminToken, excuse.race, { decision: 'APPROVED', decisionReason: 'First' }),
      decide(adminToken, excuse.race, { decision: 'REJECTED', decisionReason: 'Second' }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const winner = results.find((res) => res.status === 200)!.body;
    expect(await prisma.attendanceExcuse.findUniqueOrThrow({ where: { id: excuse.race } }))
      .toMatchObject({ status: winner.status, decisionReason: winner.decisionReason });
    expect(await prisma.auditEvent.count({ where: { action: 'attendance_excuse.decide', targetId: excuse.race } })).toBe(1);
  });

  it('AC-06: a missing or other-company excuse answers 404', async () => {
    await decide(adminToken, MISSING).expect(404);
    await decide(otherAdminToken, excuse.own).expect(404);
  });

  it('AC-07: an Admin cannot decide an excuse on their own day', async () => {
    expect((await decide(adminToken, excuse.own).expect(403)).body.code).toBe('SELF_DECISION_FORBIDDEN');
    expect(await prisma.attendanceExcuse.findUniqueOrThrow({ where: { id: excuse.own } })).toMatchObject({ status: 'PENDING' });
  });

  it('the database refuses an inconsistent status or decision', async () => {
    // Decision fields filled, so only the status CHECK can fail.
    const decided = { decidedByUserId: adminUserId, decidedAt: new Date(), decisionReason: 'x' };
    await expect(prisma.attendanceExcuse.update({ where: { id: excuse.own }, data: { status: 'MAYBE', ...decided } })).rejects.toThrow(/attendance_excuses_status_check/);
    await expect(prisma.attendanceExcuse.update({ where: { id: excuse.own }, data: { status: 'APPROVED' } })).rejects.toThrow(/attendance_excuses_decision_check/);
  });
});
