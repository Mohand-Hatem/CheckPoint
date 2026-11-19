/**
 * `point_state` view (05 §5.2, 08 point_state, C-24): one row per AWARD with quantities.
 * Needs a database created by `prisma migrate deploy`.
 */
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

type StateRow = {
  entry_id: string; point_type: PointType; quantity: number; reversed: boolean; month_locked: boolean;
  consumed_qty: number; cancelled_qty: number; available_qty: number; settled_qty: number; active_qty: number;
};

describe('point_state view (real database)', () => {
  let companyId: string;
  let adminUserId: string;
  let employeeId: string;
  let key = 0;

  const award = (pointType: PointType, workDate: string, quantity = 1) =>
    points.addPointEntryForSource({
      companyId, employeeId, pointType, quantity, sourceType: 'ADMIN',
      idempotencyKey: `state-${run}-${key++}`, reason: 'e2e', asOfDate: day(workDate),
    });

  beforeAll(async () => {
    const result = await provisionCompany(prisma, {
      name: `State ${run}`, slug: `state-${run}`, adminEmail: `state-${run}@db.test`,
      adminPassword: 'Password123!', mustChangePassword: false,
    });
    companyId = result.companyId;
    adminUserId = result.adminUserId;
    employeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: adminUserId } })).id;
    await prisma.pointValueVersion.createMany({
      data: [PointType.GREEN, PointType.RED, PointType.BLACK].map((pointType) => ({
        companyId, pointType, value: new Prisma.Decimal(100), effectiveFrom: day('2000-01-01'), effectiveTo: day('2000-12-31'),
      })),
    });
  }, 60000);

  afterAll(() => prisma.$disconnect());

  it('derives consumed, cancelled, available, settled and active quantities per entry', async () => {
    const green = await award(PointType.GREEN, '2000-01-05', 3);
    const red = await award(PointType.RED, '2000-01-06');
    const black = await award(PointType.BLACK, '2000-01-07');
    const white = await award(PointType.WHITE, '2000-01-08');
    await allocation.saveAllocations(companyId, employeeId); // RED takes 1 GREEN; 2 left are too few for the BLACK

    const reversedGreen = await award(PointType.GREEN, '2000-02-01');
    await points.reversePointEntryForSource({ companyId, entryId: reversedGreen.id, reason: 'e2e' });
    await prisma.$executeRaw`
      INSERT INTO payroll_months (company_id, month, status, locked_at, locked_by)
      VALUES (${companyId}::uuid, '2000-01-01', 'LOCKED', now(), ${adminUserId}::uuid)`;

    const rows = await prisma.$queryRaw<StateRow[]>`
      SELECT entry_id, point_type, quantity, reversed, month_locked,
             consumed_qty, cancelled_qty, available_qty, settled_qty, active_qty
      FROM point_state WHERE company_id = ${companyId}::uuid`;
    const byId = new Map(rows.map((row) => [row.entry_id, row]));
    const zero = { consumed_qty: 0, cancelled_qty: 0, available_qty: 0, settled_qty: 0, active_qty: 0 };

    expect(rows).toHaveLength(5); // AWARD rows only, the reversal row is not a point
    expect(byId.get(green.id)).toMatchObject({ ...zero, quantity: 3, reversed: false, month_locked: true, consumed_qty: 1, settled_qty: 2 });
    expect(byId.get(red.id)).toMatchObject({ ...zero, cancelled_qty: 1 });
    expect(byId.get(black.id)).toMatchObject({ ...zero, active_qty: 1 });
    expect(byId.get(white.id)).toMatchObject({ ...zero, quantity: 1 });
    expect(byId.get(reversedGreen.id)).toMatchObject({ ...zero, reversed: true, month_locked: false });
  });

  it('agrees with the engine: after a run, no open-month GREEN is left while a RED is active', async () => {
    await award(PointType.RED, '2000-03-01');
    await award(PointType.GREEN, '2000-03-02', 2);
    await allocation.saveAllocations(companyId, employeeId);

    const [totals] = await prisma.$queryRaw<{ available: number; active_red: number }[]>`
      SELECT COALESCE(SUM(available_qty) FILTER (WHERE point_type = 'GREEN'), 0)::int AS available,
             COALESCE(SUM(active_qty) FILTER (WHERE point_type = 'RED'), 0)::int AS active_red
      FROM point_state WHERE company_id = ${companyId}::uuid`;
    expect(totals).toEqual({ available: 1, active_red: 0 });
  });
});
