/**
 * FR-LOC-1: admin creates locations and assigns them to employees (Phase 2).
 * Needs a database with the current schema (see README). Creates two fresh companies per run.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { provisionCompany } from '../src/company/provision-company';
import { isValidQrToken } from '../src/location/qr-token';

const prisma = new PrismaClient();
const run = Date.now();
const PASSWORD = 'Password123!';
const OFFICE = { name: 'Main Office', latitude: 30.0444, longitude: 31.2357 };

describe('Locations and assignments (e2e, FR-LOC-1)', () => {
  let app: INestApplication;
  const tokens: Record<'A' | 'B' | 'emp', string> = { A: '', B: '', emp: '' };
  let employeeUserId: string;

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const login = async (email: string) =>
    (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    for (const c of ['A', 'B'] as const) {
      await provisionCompany(prisma, {
        name: `Loc ${c} ${run}`,
        slug: `loc-${c.toLowerCase()}-${run}`,
        adminEmail: `loc-${c.toLowerCase()}-${run}@loc.test`,
        adminPassword: PASSWORD,
        employeeNumber: 'ADMIN-001',
        mustChangePassword: false,
      });
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    tokens.A = await login(`loc-a-${run}@loc.test`);
    tokens.B = await login(`loc-b-${run}@loc.test`);
    const empEmail = `loc-emp-${run}@loc.test`;
    employeeUserId = (
      await http()
        .post('/api/admin/users')
        .set(as('A'))
        .send({ email: empEmail, fullName: 'Loc Emp', employeeCode: `LOC-${run}`, password: PASSWORD, roleCode: 'EMPLOYEE' })
        .expect(201)
    ).body.id;
    await prisma.user.update({ where: { id: employeeUserId }, data: { mustChangePassword: false } });
    tokens.emp = await login(empEmail);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('creates, lists and reads a location without ever returning the QR secret', async () => {
    const created = await http().post('/api/admin/locations').set(as('A')).send(OFFICE).expect(201);
    expect(created.body).toEqual({ id: expect.any(String), ...OFFICE, radiusMeters: 50, active: true });

    const stored = await prisma.location.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.qrSecret.length).toBe(32);

    const list = await http().get('/api/admin/locations').set(as('A')).expect(200);
    expect(list.body).toEqual([created.body]);
    await http().get(`/api/admin/locations/${created.body.id}`).set(as('A')).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('qrSecret');
  });

  it("hides another company's locations and refuses non-admins", async () => {
    const [location] = (await http().get('/api/admin/locations').set(as('A')).expect(200)).body;
    await http().get(`/api/admin/locations/${location.id}`).set(as('B')).expect(404);
    expect((await http().get('/api/admin/locations').set(as('B')).expect(200)).body).toEqual([]);
    await http().post('/api/admin/locations').set(as('emp')).send(OFFICE).expect(403);
  });

  it('replaces, lists and clears an employee assignment', async () => {
    const [location] = (await http().get('/api/admin/locations').set(as('A')).expect(200)).body;
    const path = `/api/admin/users/${employeeUserId}/locations`;

    const set = await http().put(path).set(as('A')).send({ locationIds: [location.id] }).expect(200);
    expect(set.body).toEqual([location]);
    expect((await http().get(path).set(as('A')).expect(200)).body).toEqual([location]);

    await http().put(path).set(as('A')).send({ locationIds: [] }).expect(200);
    expect((await http().get(path).set(as('A')).expect(200)).body).toEqual([]);
  });

  it('serves a rotating kiosk QR token signed with the stored secret (docs/05 §4.5)', async () => {
    const [location] = (await http().get('/api/admin/locations').set(as('A')).expect(200)).body;
    const before = Date.now();
    const res = await http().get(`/api/admin/locations/${location.id}/qr-token`).set(as('A')).expect(200);

    const { qrSecret } = await prisma.location.findUniqueOrThrow({ where: { id: location.id } });
    expect(isValidQrToken(res.body.token, Buffer.from(qrSecret), Date.now(), 30)).toBe(true);
    expect(new Date(res.body.validUntil).getTime()).toBeGreaterThan(before);
    expect(new Date(res.body.validUntil).getTime() - before).toBeLessThanOrEqual(30_000);

    await http().get(`/api/admin/locations/${location.id}/qr-token`).set(as('B')).expect(404);
    await http().get(`/api/admin/locations/${location.id}/qr-token`).set(as('emp')).expect(403);
  });

  it('rejects a location of another company or an inactive one, changing nothing', async () => {
    const path = `/api/admin/users/${employeeUserId}/locations`;
    const [mine] = (await http().get('/api/admin/locations').set(as('A')).expect(200)).body;
    await http().put(path).set(as('A')).send({ locationIds: [mine.id] }).expect(200);

    const theirs = (await http().post('/api/admin/locations').set(as('B')).send(OFFICE).expect(201)).body;
    await http().put(path).set(as('A')).send({ locationIds: [mine.id, theirs.id] }).expect(400);

    const closed = (await http().post('/api/admin/locations').set(as('A')).send({ ...OFFICE, name: 'Closed' }).expect(201)).body;
    await http().delete(`/api/admin/locations/${closed.id}`).set(as('A')).expect(200);
    await http().put(path).set(as('A')).send({ locationIds: [closed.id] }).expect(400);
    await http().get(`/api/admin/locations/${closed.id}/qr-token`).set(as('A')).expect(409);

    expect((await http().get(path).set(as('A')).expect(200)).body).toEqual([mine]);
    await http().get(`/api/admin/users/${employeeUserId}/locations`).set(as('B')).expect(404);
  });
});
