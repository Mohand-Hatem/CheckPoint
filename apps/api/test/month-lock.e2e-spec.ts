/**
 * Locked payroll month (FR-PTS-4, 08 payroll_months, C-23): no point or offset is written into it.
 * Phase 6 locks months; here a LOCKED row is inserted directly. Needs `prisma migrate deploy`.
 */
import { ConflictException } from '@nestjs/common';
import { PointType, Prisma } from '@prisma/client';
import { provisionCompany } from '../src/company/provision-company';
import { PointAllocationService } from '../src/points/point-allocation.service';
import { PointsService } from '../src/points/points.service';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const allocation = new PointAllocationService(prisma);
const points = new PointsService(prisma, allocation);
const run = Date.now();
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('Locked payroll month (real database)', () => {
  let companyId: string;
  let adminUserId: string;
  let employeeId: string;
  let key = 0;

  const award = (pointType: PointType, workDate: string) =>
    points.addPointEntryForSource({
      companyId, employeeId, pointType, quantity: 1, sourceType: 'ADMIN',
      idempotencyKey: `month-lock-${run}-${key++}`, reason: 'e2e', asOfDate: day(workDate),
    });

  beforeAll(async () => {
    const result = await provisionCompany(prisma, {
      name: `Month lock ${run}`, slug: `month-lock-${run}`, adminEmail: `month-lock-${run}@db.test`,
      adminPassword: 'Password123!', mustChangePassword: false,
    });
    companyId = result.companyId;
    adminUserId = result.adminUserId;
    employeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: adminUserId } })).id;
    await prisma.pointValueVersion.createMany({
      data: [PointType.GREEN, PointType.RED].map((pointType) => ({
        companyId, pointType, value: new Prisma.Decimal(100), effectiveFrom: day('2000-01-01'), effectiveTo: day('2000-12-31'),
      })),
    });
  }, 60000);

  afterAll(() => prisma.$disconnect());

  it('keeps a locked-month GREEN out of offsets and refuses writes into that month', async () => {
    const green = await award(PointType.GREEN, '2000-01-15');
    await prisma.$executeRaw`
      INSERT INTO payroll_months (company_id, month, status, locked_at, locked_by)
      VALUES (${companyId}::uuid, '2000-01-01', 'LOCKED', now(), ${adminUserId}::uuid)`;

    // A RED in the next (open) month is not paid by the settled GREEN.
    await award(PointType.RED, '2000-02-10');
    await allocation.saveAllocations(companyId, employeeId);
    expect(await prisma.pointOffsetAllocation.count({ where: { companyId } })).toBe(0);

    // Services answer 409 MONTH_LOCKED before the database guard fires.
    const monthLocked = expect.objectContaining({ response: expect.objectContaining({ code: 'MONTH_LOCKED' }) });
    await expect(award(PointType.RED, '2000-01-20')).rejects.toThrow(ConflictException);
    await expect(award(PointType.RED, '2000-01-21')).rejects.toEqual(monthLocked);
    await expect(
      points.reversePointEntryForSource({ companyId, entryId: green.id, reason: 'e2e' }),
    ).rejects.toEqual(monthLocked);
  });

  it('rejects a ledger row for a locked month at the database level', async () => {
    await expect(prisma.$executeRaw`
      INSERT INTO point_ledger_entries
        (company_id, employee_id, point_type, entry_kind, direction, quantity, work_date, value_per_point_piasters, source_type, idempotency_key)
      VALUES (${companyId}::uuid, ${employeeId}::uuid, 'RED', 'AWARD', 1, 1, '2000-01-31', 0, 'ADMIN', ${`month-lock-${run}-raw`})`,
    ).rejects.toThrow(/MONTH_LOCKED/);
  });

  it('rejects an offset that touches a locked-month point at the database level', async () => {
    const [green] = await prisma.pointLedgerEntry.findMany({ where: { companyId, pointType: PointType.GREEN } });
    const [red] = await prisma.pointLedgerEntry.findMany({ where: { companyId, pointType: PointType.RED } });
    await expect(
      prisma.pointOffsetAllocation.create({ data: { companyId, greenEntryId: green.id, penaltyEntryId: red.id, quantity: 1 } }),
    ).rejects.toThrow(/MONTH_LOCKED/);
  });
});
