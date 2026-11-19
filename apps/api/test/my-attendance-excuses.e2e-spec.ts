/**
 * Employee attendance excuses (REQ-034, ticket HAS-168, 05 §4.8) through the real API.
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

describe('My attendance excuses (e2e, REQ-034)', () => {
  let app: INestApplication;
  let companyId: string;
  let adminToken: string;
  let secondToken: string;
  let otherToken: string;
  const day = { mine: '', absent: '', second: '', other: '' };

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (email: string) =>
    (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;
  const submit = (token: string, attendanceDayId: string, employeeReason: unknown = 'Bus broke down') =>
    http().post(`/api/me/attendance/${attendanceDayId}/excuse`).set(auth(token)).send({ employeeReason });
  const makeDay = async (company: string, employeeId: string, workDate: string, classification: PointType, checkInResult: string) =>
    (await prisma.attendanceDay.create({
      data: {
        companyId: company, employeeId, workDate: new Date(`${workDate}T00:00:00.000Z`), timezone: 'Africa/Cairo',
        scheduledStartAt: new Date(`${workDate}T06:00:00Z`), earlyEndAt: new Date(`${workDate}T07:00:00Z`),
        graceEndAt: new Date(`${workDate}T08:00:00Z`), redPeriodEndAt: new Date(`${workDate}T10:00:00Z`),
        scheduledEndAt: new Date(`${workDate}T14:00:00Z`),
        checkInAt: checkInResult === 'ABSENT' ? null : new Date(`${workDate}T09:00:00Z`), checkInResult, classification,
      },
    })).id;
  const employeeOf = async (userId: string) => (await prisma.employee.findFirstOrThrow({ where: { userId } })).id;

  beforeAll(async () => {
    const adminEmail = `excuse-${run}@ex.test`;
    let adminUserId: string;
    ({ companyId, adminUserId } = await provisionCompany(prisma, {
      name: `Excuses ${run}`, slug: `excuses-${run}`, adminEmail, adminPassword: PASSWORD, mustChangePassword: false,
    }));
    const otherEmail = `excuse-other-${run}@ex.test`;
    const other = await provisionCompany(prisma, {
      name: `Excuses other ${run}`, slug: `excuses-other-${run}`, adminEmail: otherEmail, adminPassword: PASSWORD, mustChangePassword: false,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    adminToken = await login(adminEmail);
    otherToken = await login(otherEmail);
    const secondEmail = `excuse-emp-${run}@ex.test`;
    const secondUserId = (
      await http().post('/api/admin/users').set(auth(adminToken))
        .send({ email: secondEmail, fullName: 'Second', employeeCode: `EX-${run}`, password: PASSWORD, roleCode: 'EMPLOYEE' })
        .expect(201)
    ).body.id;
    await prisma.user.update({ where: { id: secondUserId }, data: { mustChangePassword: false } });
    secondToken = await login(secondEmail);

    const admin = await employeeOf(adminUserId);
    day.mine = await makeDay(companyId, admin, '2026-03-01', PointType.RED, 'RED');
    day.absent = await makeDay(companyId, admin, '2026-03-02', PointType.BLACK, 'ABSENT');
    day.second = await makeDay(companyId, await employeeOf(secondUserId), '2026-03-01', PointType.WHITE, 'WHITE');
    day.other = await makeDay(other.companyId, await employeeOf(other.adminUserId), '2026-03-01', PointType.RED, 'RED');
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('AC-01/05: my own day gets a PENDING excuse; attendance and points do not change', async () => {
    const before = await prisma.attendanceDay.findUniqueOrThrow({ where: { id: day.mine } });
    const ledger = await prisma.pointLedgerEntry.count({ where: { companyId } });

    const body = (await submit(adminToken, day.mine, '  Bus broke down  ').expect(201)).body;

    expect(body).toEqual({
      id: expect.any(String), attendanceDayId: day.mine, workDate: '2026-03-01', employeeReason: 'Bus broke down',
      status: 'PENDING', decisionReason: null, decidedAt: null, createdAt: expect.any(String),
    });
    expect(await prisma.attendanceDay.findUniqueOrThrow({ where: { id: day.mine } })).toEqual(before);
    expect(await prisma.pointLedgerEntry.count({ where: { companyId } })).toBe(ledger);
    expect(await prisma.auditEvent.count({ where: { companyId, action: 'attendance_excuse.submit', targetId: body.id } })).toBe(1);
  });

  it('AC-01/06: rejects a blank, missing or too long reason with 400', async () => {
    await submit(adminToken, day.absent, '   ').expect(400);
    await http().post(`/api/me/attendance/${day.absent}/excuse`).set(auth(adminToken)).send({}).expect(400);
    await submit(adminToken, day.absent, 'x'.repeat(1001)).expect(400);
    await submit(adminToken, 'not-a-uuid').expect(400);
  });

  it("AC-02: another employee's day, another company's day and a missing day all answer the same 404", async () => {
    const answers = await Promise.all([day.second, day.other, MISSING].map((id) => submit(adminToken, id).expect(404)));
    expect(new Set(answers.map((res) => res.body.message)).size).toBe(1);
    expect(await prisma.attendanceExcuse.count({ where: { attendanceDayId: { in: [day.second, day.other] } } })).toBe(0);
  });

  it('AC-03: a second excuse for the same day answers 409, also when two race', async () => {
    expect((await submit(adminToken, day.mine, 'Again').expect(409)).body.code).toBe('EXCUSE_EXISTS');

    const raced = await Promise.all([submit(adminToken, day.absent, 'One'), submit(adminToken, day.absent, 'Two')]);
    expect(raced.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await prisma.attendanceExcuse.count({ where: { attendanceDayId: day.absent } })).toBe(1);
  });

  it('AC-04: lists and opens only my own excuses in my company', async () => {
    const secondExcuse = (await submit(secondToken, day.second, 'Doctor').expect(201)).body;
    const otherExcuse = (await submit(otherToken, day.other, 'Traffic').expect(201)).body;

    const mine = (await http().get('/api/me/attendance-excuses').set(auth(adminToken)).expect(200)).body;
    expect(mine.items.map((item: { attendanceDayId: string }) => item.attendanceDayId).sort()).toEqual([day.mine, day.absent].sort());
    expect(mine.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });

    const own = mine.items[0];
    expect((await http().get(`/api/me/attendance-excuses/${own.id}`).set(auth(adminToken)).expect(200)).body).toEqual(own);
    for (const id of [secondExcuse.id, otherExcuse.id, MISSING]) {
      await http().get(`/api/me/attendance-excuses/${id}`).set(auth(adminToken)).expect(404);
    }
    const second = (await http().get('/api/me/attendance-excuses').set(auth(secondToken)).expect(200)).body;
    expect(second.items).toEqual([expect.objectContaining({ id: secondExcuse.id, status: 'PENDING' })]);
  });

  it('needs a signed-in caller', async () => {
    await http().get('/api/me/attendance-excuses').expect(401);
    await http().post(`/api/me/attendance/${day.mine}/excuse`).send({ employeeReason: 'x' }).expect(401);
  });
});
