/**
 * Absence sweep (05 §12, C-26): a working day with no check-in by the end of the red period
 * becomes ABSENT with one BLACK; re-runs add nothing. Needs `prisma migrate deploy`.
 *
 * Fixed calendar (Cairo, UTC+2 in March 2026), default shift 08:00, BLACK from 12:00, Sun–Thu:
 * February locked, Sun 1 Mar working, Mon 2 Mar holiday, Tue 3 and Wed 4 Mar working; "now" = Wed 4 Mar.
 */
import { TestingModule, Test } from '@nestjs/testing';
import { PointType, Prisma, VerificationStatus } from '@prisma/client';
import { AbsenceSweepService } from '../src/attendance/absence-sweep.service';
import { AppModule } from '../src/app.module';
import { provisionCompany } from '../src/company/provision-company';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const run = Date.now();
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const BEFORE_BLACK = new Date('2026-03-04T09:00:00.000Z'); // 11:00 Cairo
const AFTER_BLACK = new Date('2026-03-04T10:30:00.000Z'); // 12:30 Cairo

describe('Absence sweep (real database)', () => {
  let moduleRef: TestingModule;
  let sweep: AbsenceSweepService;
  let companyId: string;
  const emp = { a: '', b: '', c: '', d: '' };

  const blacks = (employeeId: string) =>
    prisma.pointLedgerEntry.findMany({
      where: { companyId, employeeId, pointType: PointType.BLACK, sourceType: 'ATTENDANCE' },
      orderBy: { workDate: 'asc' },
    });
  const dates = async (employeeId: string) =>
    (await blacks(employeeId)).map((entry) => entry.workDate.toISOString().slice(0, 10));

  beforeAll(async () => {
    let adminUserId: string;
    ({ companyId, adminUserId } = await provisionCompany(prisma, {
      name: `Sweep ${run}`, slug: `sweep-${run}`, adminEmail: `sweep-${run}@sw.test`,
      adminPassword: 'Password123!', mustChangePassword: false,
    }));
    // Shift and values in force long before the test dates.
    await prisma.shiftVersion.updateMany({ where: { companyId }, data: { effectiveFrom: day('2000-01-01') } });
    await prisma.pointValueVersion.updateMany({ where: { companyId }, data: { effectiveFrom: day('2000-01-01') } });

    const admin = await prisma.employee.findFirstOrThrow({ where: { userId: adminUserId } });
    emp.a = admin.id;
    await prisma.employee.update({ where: { id: emp.a }, data: { activeFrom: day('2000-01-01') } });
    const make = async (code: string, data: Partial<Prisma.EmployeeUncheckedCreateInput>) =>
      (await prisma.employee.create({
        data: { companyId, currentShiftId: admin.currentShiftId, employeeNumber: `${code}-${run}`, fullName: code, activeFrom: day('2000-01-01'), ...data },
      })).id;
    emp.b = await make('B', {});
    emp.c = await make('C', { activeFrom: day('2026-03-03') });
    emp.d = await make('D', { isActive: false, deactivatedAt: new Date('2026-03-01T08:00:00.000Z') });

    await prisma.$executeRaw`
      INSERT INTO payroll_months (company_id, month, status, locked_at, locked_by)
      VALUES (${companyId}::uuid, '2026-02-01', 'LOCKED', now(), ${adminUserId}::uuid)`;
    await prisma.holiday.create({ data: { companyId, holidayDate: day('2026-03-02'), name: 'Test holiday' } });

    // B checked in on 3 Mar, and has a live (not expired) pending check-in on 4 Mar.
    const windows = {
      timezone: 'Africa/Cairo', scheduledStartAt: new Date('2026-03-03T06:00:00Z'), earlyEndAt: new Date('2026-03-03T07:00:00Z'),
      graceEndAt: new Date('2026-03-03T08:00:00Z'), redPeriodEndAt: new Date('2026-03-03T10:00:00Z'), scheduledEndAt: new Date('2026-03-03T14:00:00Z'),
    };
    await prisma.attendanceDay.create({
      data: { companyId, employeeId: emp.b, workDate: day('2026-03-03'), ...windows, checkInAt: windows.scheduledStartAt, checkInResult: 'GREEN', classification: PointType.GREEN },
    });
    const location = await prisma.location.create({
      data: { companyId, name: 'Office', latitude: 30, longitude: 31, qrSecret: Buffer.from('secret') },
    });
    const verification = (employeeId: string, expiresAt: Date) => ({
      companyId, employeeId, workDate: day('2026-03-04'), locationId: location.id, startedAt: new Date(expiresAt.getTime() - 15 * 60_000),
      expiresAt, latitude: 30, longitude: 31, accuracyM: 5,
    });
    await prisma.attendanceVerification.create({ data: verification(emp.b, new Date(AFTER_BLACK.getTime() + 5 * 60_000)) });
    // A's pending check-in expired: it is marked EXPIRED and does not protect the day.
    await prisma.attendanceVerification.create({ data: verification(emp.a, new Date(BEFORE_BLACK.getTime() - 60_000)) });

    // C has 5 GREENs on 1 Mar: its first BLACK is cancelled at once.
    await prisma.pointLedgerEntry.create({
      data: {
        companyId, employeeId: emp.c, pointType: PointType.GREEN, entryKind: 'AWARD', direction: 1, quantity: 5, workDate: day('2026-03-01'),
        valuePerPointPiasters: 0n, sourceType: 'ADMIN', idempotencyKey: `sweep-${run}-greens`, reason: 'e2e',
      },
    });

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    sweep = moduleRef.get(AbsenceSweepService);
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    await prisma.$disconnect();
  });

  it('before 12:00 sweeps the past working days only, skipping locked months, holidays, attendance and inactive days', async () => {
    const result = await sweep.run(BEFORE_BLACK);

    expect(await dates(emp.a)).toEqual(['2026-03-01', '2026-03-03']);
    expect(await dates(emp.b)).toEqual(['2026-03-01']);
    expect(await dates(emp.c)).toEqual(['2026-03-03']);
    expect(await dates(emp.d)).toEqual([]);
    // The sweep covers every company in the database; other suites' companies may add to the totals.
    expect(result.failed).toBe(0);
    expect(result.absences).toBeGreaterThanOrEqual(4);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const absent = await prisma.attendanceDay.findFirstOrThrow({ where: { companyId, employeeId: emp.a, workDate: day('2026-03-01') } });
    expect(absent).toMatchObject({ checkInAt: null, checkInResult: 'ABSENT', classification: PointType.BLACK });
    const [black] = await blacks(emp.a);
    expect(black).toMatchObject({ sourceId: absent.id, idempotencyKey: `ATT:${emp.a}:2026-03-01`, quantity: 1 });
    expect(await prisma.attendanceVerification.findFirstOrThrow({ where: { employeeId: emp.a } })).toMatchObject({ status: VerificationStatus.EXPIRED });
  });

  it('runs the offset engine in the same transaction', async () => {
    const [black] = await blacks(emp.c);
    const offsets = await prisma.pointOffsetAllocation.findMany({ where: { companyId, penaltyEntryId: black.id } });
    expect(offsets.reduce((sum, row) => sum + row.quantity, 0)).toBe(5);
  });

  it('after 12:00 adds today, except for a live pending check-in', async () => {
    await sweep.run(AFTER_BLACK);
    expect(await dates(emp.a)).toEqual(['2026-03-01', '2026-03-03', '2026-03-04']);
    expect(await dates(emp.b)).toEqual(['2026-03-01']);
    expect(await dates(emp.c)).toEqual(['2026-03-03', '2026-03-04']);
  });

  it('re-running 10 times creates no extra rows', async () => {
    const count = () => Promise.all([
      prisma.pointLedgerEntry.count({ where: { companyId } }),
      prisma.attendanceDay.count({ where: { companyId } }),
      prisma.pointOffsetAllocation.count({ where: { companyId } }),
    ]);
    const before = await count();
    for (let i = 0; i < 10; i++) {
      expect(await sweep.run(AFTER_BLACK)).toMatchObject({ absences: 0, failed: 0 });
    }
    expect(await count()).toEqual(before);
  });

  it('five sweeps in parallel give one ABSENT and one BLACK per day', async () => {
    const { currentShiftId } = await prisma.employee.findUniqueOrThrow({ where: { id: emp.a } });
    const e = (await prisma.employee.create({
      data: { companyId, currentShiftId, employeeNumber: `E-${run}`, fullName: 'E', activeFrom: day('2026-03-01') },
    })).id;

    const results = await Promise.all([0, 1, 2, 3, 4].map(() => sweep.run(AFTER_BLACK)));

    expect(results.map((r) => r.failed)).toEqual([0, 0, 0, 0, 0]);
    expect(await dates(e)).toEqual(['2026-03-01', '2026-03-03', '2026-03-04']);
    expect(await prisma.attendanceDay.count({ where: { companyId, employeeId: e } })).toBe(3);
  });
});
