/**
 * Offset engine on a real database (05 §5.3, 08 point_offset_allocations, U-5).
 * Needs a database created by `prisma migrate deploy` (the append-only triggers are not in `db push`).
 */
import { PointType } from '@prisma/client';
import { provisionCompany } from '../src/company/provision-company';
import { PointAllocationService } from '../src/points/point-allocation.service';
import { PointsService } from '../src/points/points.service';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const allocation = new PointAllocationService(prisma);
const points = new PointsService(prisma, allocation);
const run = Date.now();

describe('Offset engine (real database)', () => {
  let companyId: string;
  let adminUserId: string;
  let employeeId: string;
  let key = 0;

  const add = (pointType: PointType, quantity = 1) =>
    points.addPointEntry(companyId, adminUserId, { employeeId, pointType, quantity, reason: 'e2e' }, `offsets-${run}-${key++}`);
  const reverse = (entryId: string) => points.reversePointEntry(companyId, adminUserId, entryId, { reason: 'e2e undo' });
  const active = () =>
    prisma.pointOffsetAllocation.findMany({
      where: { companyId, reversesAllocationId: null, undoneBy: { is: null } },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    const result = await provisionCompany(prisma, {
      name: `Offsets ${run}`, slug: `offsets-${run}`, adminEmail: `offsets-${run}@db.test`,
      adminPassword: 'Password123!', mustChangePassword: false,
    });
    companyId = result.companyId;
    adminUserId = result.adminUserId;
    employeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: adminUserId } })).id;
    // provisioning already configures the GREEN / RED / BLACK values
  }, 60000);

  afterAll(() => prisma.$disconnect());

  it('walks a RED / GREEN / BLACK history with reversals, always append-only', async () => {
    // 1. A GREEN cancels an open RED at once.
    const red = await add(PointType.RED);
    const green1 = await add(PointType.GREEN);
    expect(await active()).toEqual([
      expect.objectContaining({ greenEntryId: green1.id, penaltyEntryId: red.id, quantity: 1 }),
    ]);

    // 2. Reversing that GREEN writes an UNDO row; the RED is open again.
    await reverse(green1.id);
    expect(await active()).toEqual([]);
    const undo = await prisma.pointOffsetAllocation.findFirstOrThrow({
      where: { companyId, reversesAllocationId: { not: null } },
    });
    expect(undo).toMatchObject({ greenEntryId: green1.id, penaltyEntryId: red.id, quantity: 1 });

    // 3. Six new GREENs: one pays the RED (REDs first), five are left.
    const green2 = await add(PointType.GREEN, 6);
    expect(await active()).toEqual([
      expect.objectContaining({ greenEntryId: green2.id, penaltyEntryId: red.id, quantity: 1 }),
    ]);

    // 4. A BLACK takes exactly the five left (no partial).
    const black = await add(PointType.BLACK);
    expect(await active()).toEqual([
      expect.objectContaining({ penaltyEntryId: red.id, quantity: 1 }),
      expect.objectContaining({ greenEntryId: green2.id, penaltyEntryId: black.id, quantity: 5 }),
    ]);

    // 5. Reversing the BLACK frees its five GREENs; the RED stays paid.
    await reverse(black.id);
    expect(await active()).toEqual([expect.objectContaining({ penaltyEntryId: red.id, quantity: 1 })]);

    // 6. Running again changes nothing (idempotent).
    const before = await prisma.pointOffsetAllocation.count({ where: { companyId } });
    await allocation.saveAllocations(companyId, employeeId);
    expect(await prisma.pointOffsetAllocation.count({ where: { companyId } })).toBe(before);
  });

  it('rejects UPDATE and DELETE on offset rows (database trigger)', async () => {
    const row = await prisma.pointOffsetAllocation.findFirstOrThrow({ where: { companyId } });
    await expect(
      prisma.pointOffsetAllocation.update({ where: { id: row.id }, data: { quantity: 9 } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.pointOffsetAllocation.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});
