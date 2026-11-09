/**
 * FR-CAL-1: holidays, weekly off days and isWorkingDay against a real database (Phase 2).
 * Needs a database with the current schema (see README). Creates two fresh companies per run.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { CalendarService } from '../src/calendar/calendar.service';
import { provisionCompany } from '../src/company/provision-company';

const prisma = new PrismaClient();
const run = Date.now();
const PASSWORD = 'Password123!';
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
// 2026-12-25 is a Friday, 2026-12-27 a Sunday.

describe('Calendar (e2e, FR-CAL-1)', () => {
  let app: INestApplication;
  const companies: Record<'A' | 'B', { id: string; token: string }> = { A: { id: '', token: '' }, B: { id: '', token: '' } };

  const http = () => request(app.getHttpServer());
  const as = (c: 'A' | 'B') => ({ Authorization: `Bearer ${companies[c].token}` });

  beforeAll(async () => {
    for (const c of ['A', 'B'] as const) {
      companies[c].id = (
        await provisionCompany(prisma, {
          name: `Cal ${c} ${run}`,
          slug: `cal-${c.toLowerCase()}-${run}`,
          adminEmail: `cal-${c.toLowerCase()}-${run}@cal.test`,
          adminPassword: PASSWORD,
          employeeNumber: 'ADMIN-001',
          mustChangePassword: false,
        })
      ).companyId;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    for (const c of ['A', 'B'] as const) {
      companies[c].token = (
        await http().post('/api/auth/login').send({ email: `cal-${c.toLowerCase()}-${run}@cal.test`, password: PASSWORD }).expect(200)
      ).body.accessToken;
    }
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('weekly off days start as FRI/SAT and can be replaced, but not with all seven', async () => {
    expect((await http().get('/api/admin/settings/weekly-off-days').set(as('A')).expect(200)).body).toEqual({
      days: ['FRI', 'SAT'],
    });
    await http().put('/api/admin/settings/weekly-off-days').set(as('A')).send({ days: ['SAT', 'SUN', 'XYZ'] }).expect(400);
    await http()
      .put('/api/admin/settings/weekly-off-days')
      .set(as('A'))
      .send({ days: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] })
      .expect(400);

    const res = await http().put('/api/admin/settings/weekly-off-days').set(as('A')).send({ days: ['SAT', 'FRI'] }).expect(200);
    expect(res.body).toEqual({ days: ['FRI', 'SAT'] });
  });

  it('adds, lists and removes holidays; one per date per company', async () => {
    const created = await http().post('/api/admin/holidays').set(as('A')).send({ date: '2026-12-27', name: 'Founders Day' }).expect(201);
    expect(created.body).toEqual({ id: expect.any(String), date: '2026-12-27', name: 'Founders Day' });

    await http().post('/api/admin/holidays').set(as('A')).send({ date: '2026-12-27', name: 'Again' }).expect(409);
    await http().post('/api/admin/holidays').set(as('A')).send({ date: '2026-02-30', name: 'Nope' }).expect(400);
    await http().post('/api/admin/holidays').set(as('B')).send({ date: '2026-12-27', name: 'Their own' }).expect(201);

    expect((await http().get('/api/admin/holidays?year=2026').set(as('A')).expect(200)).body).toEqual([created.body]);
    expect((await http().get('/api/admin/holidays?year=2025').set(as('A')).expect(200)).body).toEqual([]);
    await http().delete(`/api/admin/holidays/${created.body.id}`).set(as('B')).expect(404);
  });

  it('isWorkingDay reads the real setting and the DATE column correctly', async () => {
    const calendar = app.get(CalendarService);
    await expect(calendar.isWorkingDay(companies.A.id, day('2026-12-25'))).resolves.toBe(false); // Friday
    await expect(calendar.isWorkingDay(companies.A.id, day('2026-12-27'))).resolves.toBe(false); // holiday
    await expect(calendar.isWorkingDay(companies.A.id, day('2026-12-28'))).resolves.toBe(true); // Monday

    const [holiday] = (await http().get('/api/admin/holidays?year=2026').set(as('A')).expect(200)).body;
    await http().delete(`/api/admin/holidays/${holiday.id}`).set(as('A')).expect(200);
    await expect(calendar.isWorkingDay(companies.A.id, day('2026-12-27'))).resolves.toBe(true);
  });
});
