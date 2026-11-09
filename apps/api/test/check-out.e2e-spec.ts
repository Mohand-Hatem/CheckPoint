/**
 * REQ-014 / FR-ATT-5: employee checkout through the real API and database.
 * Needs a database with the current schema (see README). Creates a fresh company per run.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { CompanyPolicyService } from '../src/company/company-policy.service';
import { provisionCompany } from '../src/company/provision-company';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();
const run = Date.now();
const PASSWORD = 'Password123!';
const AT_OFFICE = { lat: 30.0444, lng: 31.2357, accuracy: 10 };
const HOUR = 3_600_000;

describe('Employee checkout (e2e, REQ-014, FR-ATT-5)', () => {
  let app: INestApplication;
  let token: string;
  let companyId: string;
  let employeeId: string;
  let workDate: Date;

  const checkOut = (body: object) =>
    request(app.getHttpServer())
      .post('/api/employee/attendance/check-out')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    const admin = `checkout-${run}@co.test`;
    ({ companyId } = await provisionCompany(prisma, {
      name: `Checkout ${run}`,
      slug: `checkout-${run}`,
      adminEmail: admin,
      adminPassword: PASSWORD,
      employeeNumber: 'ADMIN-001',
      mustChangePassword: false,
    }));
    employeeId = (await prisma.employee.findFirstOrThrow({ where: { companyId }, select: { id: true } })).id;
    workDate = await new CompanyPolicyService(prisma as unknown as PrismaService).getCompanyDate(companyId);

    const location = await prisma.location.create({
      data: { companyId, name: 'Office', latitude: AT_OFFICE.lat, longitude: AT_OFFICE.lng, radiusM: 50, qrSecret: randomBytes(32) },
    });
    await prisma.employeeLocation.create({ data: { companyId, employeeId, locationId: location.id } });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: admin, password: PASSWORD }).expect(200);
    token = res.body.accessToken;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('answers 422 INVALID_STATE without a check-in today', async () => {
    const res = await checkOut(AT_OFFICE).expect(422);
    expect(res.body.code).toBe('INVALID_STATE');
  });

  it('rejects a client-supplied time or overtime amount', async () => {
    await checkOut({ ...AT_OFFICE, checkOutAt: new Date().toISOString(), overtimeGreens: 9 }).expect(400);
  });

  describe('after a check-in', () => {
    beforeAll(async () => {
      const now = Date.now();
      // Shift ended 2.5 h ago, so a checkout now earns 2 overtime GREENs.
      await prisma.attendanceDay.create({
        data: {
          companyId,
          employeeId,
          workDate,
          timezone: 'Africa/Cairo',
          scheduledStartAt: new Date(now - 10.5 * HOUR),
          earlyEndAt: new Date(now - 10 * HOUR),
          graceEndAt: new Date(now - 9.5 * HOUR),
          redPeriodEndAt: new Date(now - 9 * HOUR),
          scheduledEndAt: new Date(now - 2.5 * HOUR),
          checkInAt: new Date(now - 10.5 * HOUR),
          checkInResult: 'GREEN',
          classification: 'GREEN',
        },
      });
    });

    it('rejects poor GPS accuracy and a position outside the location, writing nothing', async () => {
      const low = await checkOut({ ...AT_OFFICE, accuracy: 500 }).expect(422);
      expect(low.body.code).toBe('GPS_ACCURACY_TOO_LOW');
      await checkOut({ ...AT_OFFICE, lat: 31.2 }).expect(403);

      const day = await prisma.attendanceDay.findFirstOrThrow({ where: { companyId, employeeId, workDate } });
      expect(day.checkOutAt).toBeNull();
    });

    it('records the checkout at server time and awards 2 overtime GREENs', async () => {
      const before = Date.now();
      const res = await checkOut(AT_OFFICE).expect(200);

      expect(res.body.overtimeGreens).toBe(2);
      const checkOutAt = new Date(res.body.checkOutAt).getTime();
      expect(checkOutAt).toBeGreaterThanOrEqual(before - 1000);
      expect(checkOutAt).toBeLessThanOrEqual(Date.now() + 1000);

      const day = await prisma.attendanceDay.findFirstOrThrow({ where: { companyId, employeeId, workDate } });
      expect(day.checkOutAt?.getTime()).toBe(checkOutAt);
      expect(day).toMatchObject({ overtimeGreens: 2, leftEarly: false });
    });

    it('answers 409 ALREADY_CHECKED_OUT on a second checkout and awards nothing more', async () => {
      const res = await checkOut(AT_OFFICE).expect(409);
      expect(res.body.code).toBe('ALREADY_CHECKED_OUT');

      const overtime = await prisma.pointLedgerEntry.findMany({ where: { companyId, employeeId, sourceType: 'OVERTIME' } });
      expect(overtime).toHaveLength(1);
      expect(overtime[0]).toMatchObject({ pointType: 'GREEN', quantity: 2 });
    });
  });
});
