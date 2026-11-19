/**
 * Offsets follow the point's work date, not when the row was written (05 §5.3, C-22).
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

describe('Point work date (real database)', () => {
  let companyId: string;
  let adminUserId: string;
  let employeeId: string;

  beforeAll(async () => {
    const result = await provisionCompany(prisma, {
      name: `Work date ${run}`, slug: `work-date-${run}`, adminEmail: `work-date-${run}@db.test`,
      adminPassword: 'Password123!', mustChangePassword: false,
    });
    companyId = result.companyId;
    adminUserId = result.adminUserId;
    employeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: adminUserId } })).id;
    // Values for an old period, so the test does not depend on today's date.
    await prisma.pointValueVersion.createMany({
      data: [PointType.GREEN, PointType.RED].map((pointType) => ({
        companyId, pointType, value: new Prisma.Decimal(100), effectiveFrom: day('2000-01-01'), effectiveTo: day('2000-12-31'),
      })),
    });
  }, 60000);

  afterAll(() => prisma.$disconnect());

  const red = (workDate: string) =>
    points.addPointEntryForSource({
      companyId, employeeId, pointType: PointType.RED, quantity: 1, sourceType: 'ADMIN',
      idempotencyKey: `work-date-${run}-${workDate}`, reason: 'e2e', asOfDate: day(workDate),
    });

  it('stores the work date and cancels the RED with the oldest work date first', async () => {
    const newer = await red('2000-01-20'); // written first
    const older = await red('2000-01-10'); // written second, but belongs to an earlier day
    expect(newer.workDate).toEqual(day('2000-01-20'));
    expect(older.workDate).toEqual(day('2000-01-10'));

    await points.addPointEntry(companyId, adminUserId, { employeeId, pointType: PointType.GREEN, quantity: 1, reason: 'e2e' }, `work-date-${run}-green`);

    const offsets = await prisma.pointOffsetAllocation.findMany({ where: { companyId } });
    expect(offsets).toEqual([expect.objectContaining({ penaltyEntryId: older.id, quantity: 1 })]);
  });
});
