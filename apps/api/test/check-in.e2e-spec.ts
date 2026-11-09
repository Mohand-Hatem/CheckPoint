/**
 * FR-ATT-1/2 two-step check-in through the real API and database (Phase 3 DoD):
 * GPS alone never creates attendance; the kiosk QR of the same location confirms it within 15 minutes.
 * Needs a database with the current schema (see README). Creates a fresh company per run.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { CompanyPolicyService } from '../src/company/company-policy.service';
import { provisionCompany } from '../src/company/provision-company';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();
const run = Date.now();
const PASSWORD = 'Password123!';
const AT_OFFICE = { lat: 30.0444, lng: 31.2357, accuracy: 10 };

describe('Two-step check-in (e2e, FR-ATT-1/2)', () => {
  let app: INestApplication;
  let companyId: string;
  let adminToken: string;
  let adminEmployeeId: string;
  let officeId: string;
  let workDate: Date;
  const second = { email: `ci-emp-${run}@ci.test`, token: '', employeeId: '' };

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (email: string) =>
    (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;
  const step1 = (token: string, body: object = AT_OFFICE) =>
    http().post('/api/employee/attendance/check-in').set(auth(token)).send(body);
  const confirm = (token: string, verificationId: string, qrToken: string) =>
    http().post('/api/employee/attendance/check-in/confirm').set(auth(token)).send({ verificationId, qrToken });
  const kioskToken = async (locationId: string) =>
    (await http().get(`/api/admin/locations/${locationId}/qr-token`).set(auth(adminToken)).expect(200)).body.token as string;
  const dayOf = (employeeId: string) =>
    prisma.attendanceDay.findFirst({ where: { companyId, employeeId, workDate } });

  beforeAll(async () => {
    const adminEmail = `ci-admin-${run}@ci.test`;
    ({ companyId } = await provisionCompany(prisma, {
      name: `CheckIn ${run}`,
      slug: `checkin-${run}`,
      adminEmail,
      adminPassword: PASSWORD,
      employeeNumber: 'ADMIN-001',
      mustChangePassword: false,
    }));
    adminEmployeeId = (await prisma.employee.findFirstOrThrow({ where: { companyId }, select: { id: true } })).id;
    workDate = await new CompanyPolicyService(prisma as unknown as PrismaService).getCompanyDate(companyId);

    // Open the company's shift a few minutes ago (company-local wall clock), so this run classifies GREEN.
    const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date())
      .split(':')
      .map(Number);
    const startMinutes = Math.max(0, h * 60 + m - 5);
    await prisma.shiftVersion.updateMany({
      where: { companyId },
      data: {
        startTime: new Date(Date.UTC(1970, 0, 1, 0, startMinutes)),
        endTime: new Date(Date.UTC(1970, 0, 1, 23, 59)),
      },
    });

    // Every weekday is a working day for this company, so the run does not depend on today's weekday.
    await prisma.setting.update({ where: { companyId_key: { companyId, key: 'weekly_off_days' } }, data: { value: [] } });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    adminToken = await login(adminEmail);
    const adminUserId = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64url').toString()).sub;
    officeId = (
      await http()
        .post('/api/admin/locations')
        .set(auth(adminToken))
        .send({ name: 'Office', latitude: AT_OFFICE.lat, longitude: AT_OFFICE.lng })
        .expect(201)
    ).body.id;
    await http().put(`/api/admin/users/${adminUserId}/locations`).set(auth(adminToken)).send({ locationIds: [officeId] }).expect(200);

    const secondUserId = (
      await http()
        .post('/api/admin/users')
        .set(auth(adminToken))
        .send({ email: second.email, fullName: 'Second', employeeCode: `CI-${run}`, password: PASSWORD, roleCode: 'EMPLOYEE' })
        .expect(201)
    ).body.id;
    await prisma.user.update({ where: { id: secondUserId }, data: { mustChangePassword: false } });
    second.employeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: secondUserId }, select: { id: true } })).id;
    await http().put(`/api/admin/users/${secondUserId}/locations`).set(auth(adminToken)).send({ locationIds: [officeId] }).expect(200);
    second.token = await login(second.email);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('step 1 checks accuracy and geofence, then creates a pending verification and no attendance', async () => {
    expect((await step1(adminToken, { ...AT_OFFICE, accuracy: 500 }).expect(422)).body.code).toBe('GPS_ACCURACY_TOO_LOW');
    await step1(adminToken, { ...AT_OFFICE, lat: 31.2 }).expect(403);

    const started = (await step1(adminToken).expect(201)).body;
    expect(started).toMatchObject({ verificationId: expect.any(String), locationId: officeId, status: 'PENDING' });
    expect(new Date(started.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(await dayOf(adminEmployeeId)).toBeNull();

    const again = (await step1(adminToken).expect(201)).body;
    expect(again.verificationId).toBe(started.verificationId);
  });

  it('confirm rejects a bad token and a token of another location, recording nothing', async () => {
    const { verificationId } = (await step1(adminToken).expect(201)).body;
    expect((await confirm(adminToken, verificationId, 'garbage').expect(422)).body.code).toBe('QR_TOKEN_INVALID');

    const elsewhere = (
      await http().post('/api/admin/locations').set(auth(adminToken)).send({ name: 'Elsewhere', latitude: 29.9, longitude: 31.1 }).expect(201)
    ).body.id;
    expect((await confirm(adminToken, verificationId, await kioskToken(elsewhere)).expect(422)).body.code).toBe('QR_LOCATION_MISMATCH');

    await confirm(second.token, verificationId, await kioskToken(officeId)).expect(404);
    expect(await dayOf(adminEmployeeId)).toBeNull();
  });

  it("confirm with the kiosk's live token records the day at the step-1 time with its point", async () => {
    const { verificationId } = (await step1(adminToken).expect(201)).body;
    const res = await confirm(adminToken, verificationId, await kioskToken(officeId)).expect(201);
    expect(res.body.pointEntries).toHaveLength(1);

    const verification = await prisma.attendanceVerification.findUniqueOrThrow({ where: { id: verificationId } });
    const day = await dayOf(adminEmployeeId);
    expect(verification.status).toBe('CONFIRMED');
    expect(day?.checkInAt?.getTime()).toBe(verification.startedAt.getTime());
    expect(day?.classification).toBe('GREEN');

    expect((await confirm(adminToken, verificationId, await kioskToken(officeId)).expect(409)).body.code).toBe('ALREADY_CHECKED_IN');
    expect((await step1(adminToken).expect(409)).body.code).toBe('ALREADY_CHECKED_IN');
    const ledger = await prisma.pointLedgerEntry.count({ where: { companyId, employeeId: adminEmployeeId, sourceType: 'ATTENDANCE' } });
    expect(ledger).toBe(1);
  });

  it('two simultaneous step-1 calls share one verification; an expired one answers 410 and a new start works', async () => {
    const [a, b] = await Promise.all([step1(second.token), step1(second.token)]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.verificationId).toBe(b.body.verificationId);
    expect(await prisma.attendanceVerification.count({ where: { employeeId: second.employeeId, status: 'PENDING' } })).toBe(1);

    // Simulate 15 minutes passing for this verification only.
    await prisma.attendanceVerification.update({
      where: { id: a.body.verificationId },
      data: { startedAt: new Date(Date.now() - 16 * 60_000), expiresAt: new Date(Date.now() - 60_000) },
    });
    const expired = await confirm(second.token, a.body.verificationId, await kioskToken(officeId)).expect(410);
    expect(expired.body.code).toBe('VERIFICATION_EXPIRED');
    expect((await prisma.attendanceVerification.findUniqueOrThrow({ where: { id: a.body.verificationId } })).status).toBe('EXPIRED');
    expect(await dayOf(second.employeeId)).toBeNull();

    const fresh = (await step1(second.token).expect(201)).body;
    expect(fresh.verificationId).not.toBe(a.body.verificationId);
  });

  it('a weekly off day needs an OFF_DAY_WORK exception, and then counts as GREEN (FR-CAL-1/2/3)', async () => {
    const email = `ci-off-${run}@ci.test`;
    const userId = (
      await http()
        .post('/api/admin/users')
        .set(auth(adminToken))
        .send({ email, fullName: 'Off Day', employeeCode: `CI-OFF-${run}`, password: PASSWORD, roleCode: 'EMPLOYEE' })
        .expect(201)
    ).body.id;
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: false } });
    const employeeId = (await prisma.employee.findFirstOrThrow({ where: { userId }, select: { id: true } })).id;
    await http().put(`/api/admin/users/${userId}/locations`).set(auth(adminToken)).send({ locationIds: [officeId] }).expect(200);
    const token = await login(email);

    const today = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][workDate.getUTCDay()];
    await http().put('/api/admin/settings/weekly-off-days').set(auth(adminToken)).send({ days: [today] }).expect(200);
    expect((await step1(token).expect(422)).body.code).toBe('NOT_A_WORKING_DAY');

    await http()
      .post('/api/admin/work-offers')
      .set(auth(adminToken))
      .send({
        offerType: 'OFF_DAY_WORK',
        startsAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        description: 'Inventory day',
        allEmployees: false,
        employeeIds: [employeeId],
      })
      .expect(201);

    const { verificationId } = (await step1(token).expect(201)).body;
    await confirm(token, verificationId, await kioskToken(officeId)).expect(201);
    const day = await dayOf(employeeId);
    expect(day).toMatchObject({ checkInResult: 'OFF_DAY_WORK', classification: 'GREEN' });
  });
});
