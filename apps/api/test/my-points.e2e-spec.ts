/**
 * Employee point queries (05 §2 `GET /me/points`, `GET /me/points/summary`) through the real API.
 * Reads `point_state`; the signed-in employee only. Needs `prisma migrate deploy`.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PointType, Prisma } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { provisionCompany } from '../src/company/provision-company';
import { PointAllocationService } from '../src/points/point-allocation.service';
import { PointsService } from '../src/points/points.service';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const allocation = new PointAllocationService(prisma);
const points = new PointsService(prisma, allocation);
const run = Date.now();
const PASSWORD = 'Password123!';
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('My points (e2e)', () => {
  let app: INestApplication;
  let companyId: string;
  let adminUserId: string;
  let adminEmployeeId: string;
  let adminToken: string;
  let secondToken: string;
  let secondEmployeeId: string;
  let key = 0;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (email: string) =>
    (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;
  const award = (employeeId: string, pointType: PointType, workDate: string, quantity = 1) =>
    points.addPointEntryForSource({
      companyId, employeeId, pointType, quantity, sourceType: 'ADMIN',
      idempotencyKey: `my-points-${run}-${key++}`, reason: `e2e ${pointType}`, asOfDate: day(workDate),
    });

  beforeAll(async () => {
    const adminEmail = `my-points-${run}@mp.test`;
    ({ companyId, adminUserId } = await provisionCompany(prisma, {
      name: `My points ${run}`, slug: `my-points-${run}`, adminEmail, adminPassword: PASSWORD, mustChangePassword: false,
    }));
    adminEmployeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: adminUserId } })).id;
    await prisma.pointValueVersion.createMany({
      data: [PointType.GREEN, PointType.RED, PointType.BLACK].map((pointType) => ({
        companyId, pointType, value: new Prisma.Decimal(100), effectiveFrom: day('2000-01-01'), effectiveTo: day('2000-12-31'),
      })),
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    adminToken = await login(adminEmail);
    const secondEmail = `my-points-emp-${run}@mp.test`;
    const secondUserId = (
      await http().post('/api/admin/users').set(auth(adminToken))
        .send({ email: secondEmail, fullName: 'Second', employeeCode: `MP-${run}`, password: PASSWORD, roleCode: 'EMPLOYEE' })
        .expect(201)
    ).body.id;
    await prisma.user.update({ where: { id: secondUserId }, data: { mustChangePassword: false } });
    secondEmployeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: secondUserId } })).id;
    secondToken = await login(secondEmail);

    // Admin (also an employee): 3 GREEN, 1 RED (paid by one GREEN), 1 WHITE in Jan 2000.
    await award(adminEmployeeId, PointType.GREEN, '2000-01-05', 3);
    await award(adminEmployeeId, PointType.RED, '2000-01-06');
    await award(adminEmployeeId, PointType.WHITE, '2000-01-07');
    await allocation.saveAllocations(companyId, adminEmployeeId);
    await award(secondEmployeeId, PointType.RED, '2000-01-10');
    // A GREEN dated today, for the default month.
    await points.addPointEntry(companyId, adminUserId, { employeeId: adminEmployeeId, pointType: PointType.GREEN, quantity: 1, reason: 'today' }, `my-points-${run}-today`);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('lists only my points of the month, newest work date first, with their state', async () => {
    const body = (await http().get('/api/me/points?month=2000-01').set(auth(adminToken)).expect(200)).body;
    expect(body.month).toBe('2000-01');
    expect(body.items.map((item: { pointType: string }) => item.pointType)).toEqual(['WHITE', 'RED', 'GREEN']);
    expect(body.items[2]).toMatchObject({
      workDate: '2000-01-05', quantity: 3, reversed: false, monthLocked: false,
      consumedQty: 1, availableQty: 2, settledQty: 0, cancelledQty: 0, activeQty: 0, reason: 'e2e GREEN',
    });
    expect(body.items[1]).toMatchObject({ cancelledQty: 1, activeQty: 0 });
    expect(body.pagination).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });

    const second = (await http().get('/api/me/points?month=2000-01').set(auth(secondToken)).expect(200)).body;
    expect(second.items).toEqual([expect.objectContaining({ pointType: 'RED', workDate: '2000-01-10', activeQty: 1 })]);
  });

  it('filters by type and pages', async () => {
    const greens = (await http().get('/api/me/points?month=2000-01&type=GREEN').set(auth(adminToken)).expect(200)).body;
    expect(greens.items).toHaveLength(1);

    const page2 = (await http().get('/api/me/points?month=2000-01&page=2&limit=2').set(auth(adminToken)).expect(200)).body;
    expect(page2.items.map((item: { pointType: string }) => item.pointType)).toEqual(['GREEN']);
    expect(page2.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('defaults to the current company month', async () => {
    const body = (await http().get('/api/me/points').set(auth(adminToken)).expect(200)).body;
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
    expect(body.items).toEqual([expect.objectContaining({ pointType: 'GREEN', reason: 'today', availableQty: 1 })]);
  });

  it('summarises my month by type and state', async () => {
    const body = (await http().get('/api/me/points/summary?month=2000-01').set(auth(adminToken)).expect(200)).body;
    expect(body).toEqual({
      month: '2000-01',
      green: { total: 3, available: 2, consumed: 1, settled: 0 },
      red: { total: 1, active: 0, cancelled: 1 },
      black: { total: 0, active: 0, cancelled: 0 },
      white: { total: 1 },
    });
  });

  it('rejects a bad month or type and an anonymous caller', async () => {
    await http().get('/api/me/points?month=2000-13').set(auth(adminToken)).expect(400);
    await http().get('/api/me/points?type=PURPLE').set(auth(adminToken)).expect(400);
    await http().get('/api/me/points/summary?month=jan').set(auth(adminToken)).expect(400);
    await http().get('/api/me/points').expect(401);
  });
});
