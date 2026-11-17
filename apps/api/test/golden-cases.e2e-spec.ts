/**
 * Golden cases G1–G5, G7, G8 (05 §15.4), points part only: counts, consumed, remaining, potential.
 * Points arrive one by one in chronological order, so the engine runs exactly as in production.
 * Money uses the doc's assumptions (Green 1000, Red 250, Black 1000 EGP). Payroll/fund (G6, G9) are Phase 6.
 */
import { PointType } from '@prisma/client';
import { provisionCompany } from '../src/company/provision-company';
import { PointAllocationService } from '../src/points/point-allocation.service';
import { PointsService } from '../src/points/points.service';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const points = new PointsService(prisma, new PointAllocationService(prisma));
const run = Date.now();
const { GREEN: G, WHITE: W, RED: R, BLACK: B } = PointType;
const ACTIVE = { reversesAllocationId: null, undoneBy: { is: null } } as const;
const EGP = { GREEN: 1000, RED: 250, BLACK: 1000 };

let seq = 0;
async function employee() {
  const n = seq++;
  const { companyId, adminUserId } = await provisionCompany(prisma, {
    name: `Golden ${run}-${n}`, slug: `golden-${run}-${n}`, adminEmail: `golden-${run}-${n}@db.test`,
    adminPassword: 'Password123!', mustChangePassword: false,
  });
  const { id: employeeId } = await prisma.employee.findFirstOrThrow({ where: { userId: adminUserId } });
  let key = 0;
  const add = async (...types: PointType[]) => {
    const ids: string[] = [];
    for (const pointType of types) {
      const entry = await points.addPointEntry(
        companyId, adminUserId, { employeeId, pointType, quantity: 1, reason: 'golden' }, `g-${run}-${n}-${key++}`,
      );
      ids.push(entry.id);
    }
    return ids;
  };
  const addMany = async (pointType: PointType, quantity: number) =>
    points.addPointEntry(companyId, adminUserId, { employeeId, pointType, quantity, reason: 'golden' }, `g-${run}-${n}-${key++}`);
  const reverse = (entryId: string) => points.reversePointEntry(companyId, adminUserId, entryId, { reason: 'golden reverse' });
  return { companyId, add, addMany, reverse, totals: () => totals(companyId) };
}

async function totals(companyId: string) {
  const live = await prisma.pointLedgerEntry.findMany({
    where: { companyId, entryKind: 'AWARD', reversalEntries: { none: {} } },
  });
  const rows = await prisma.pointOffsetAllocation.findMany({ where: { companyId, ...ACTIVE }, include: { penaltyEntry: true } });
  const earned = (t: PointType) => live.filter((e) => e.pointType === t).reduce((s, e) => s + e.quantity, 0);
  const usedOn = (t: PointType) => rows.filter((r) => r.penaltyEntry.pointType === t).reduce((s, r) => s + r.quantity, 0);
  const consumed = usedOn(R) + usedOn(B);
  const activeReds = earned(R) - usedOn(R);
  const activeBlacks = earned(B) - usedOn(B) / 5;
  return {
    greens: earned(G), whites: earned(W), consumed, remaining: earned(G) - consumed,
    activeReds, activeBlacks,
    fundEgp: (earned(G) - consumed) * EGP.GREEN,
    potentialEgp: activeReds * EGP.RED + activeBlacks * EGP.BLACK,
  };
}

const times = <T>(n: number, v: T) => Array<T>(n).fill(v);

describe('Golden cases (05 §15.4, points part)', () => {
  afterAll(() => prisma.$disconnect());

  it('G1 — SoT example: 20 Early, 5 Normal, 3 Late, 2 Absent, 10 overtime Greens', async () => {
    const e = await employee();
    // 30 days in a realistic order, overtime Greens arriving along the way
    await e.add(...times(5, G), R, W, ...times(5, G), B, ...times(3, G), W, R, ...times(4, G), W, B, ...times(3, G), W, R, W);
    await e.add(...times(10, G)); // overtime
    expect(await e.totals()).toEqual({
      greens: 30, whites: 5, consumed: 13, remaining: 17, activeReds: 0, activeBlacks: 0,
      fundEgp: 17000, potentialEgp: 0,
    });
  }, 120000);

  it('G2 — scarce Greens: 2 Early first, then 14 Normal, 4 Late, 2 Absent', async () => {
    const e = await employee();
    await e.add(G, G, ...times(14, W));
    const reds = await e.add(R, R, R, R);
    await e.add(B, B);
    expect(await e.totals()).toMatchObject({ consumed: 2, remaining: 0, activeReds: 2, activeBlacks: 2, fundEgp: 0, potentialEgp: 2500 });
    // the two OLDEST Reds are the cancelled ones
    const cancelled = await prisma.pointOffsetAllocation.findMany({ where: { companyId: e.companyId, ...ACTIVE } });
    expect(cancelled.map((r) => r.penaltyEntryId).sort()).toEqual(reds.slice(0, 2).sort());
  }, 120000);

  it('G3 — SoT §10: 10 Early, 10 Normal, 2 Late ⇒ 8 Greens remain (Fund 8,000, not 10,000)', async () => {
    const e = await employee();
    await e.add(...times(10, G), ...times(10, W), R, R);
    expect(await e.totals()).toMatchObject({ greens: 10, consumed: 2, remaining: 8, fundEgp: 8000, potentialEgp: 0 });
  }, 120000);

  it('G4 order A — 5 Greens, then Black, then Red: Black cancelled, Red stays (250 EGP)', async () => {
    const e = await employee();
    await e.add(...times(5, G), B, R);
    expect(await e.totals()).toMatchObject({ consumed: 5, remaining: 0, activeReds: 1, activeBlacks: 0, potentialEgp: 250 });
  }, 120000);

  it('G4 order B — 5 Greens, then Red, then Black: Red cancelled, Black stays (1,000 EGP)', async () => {
    const e = await employee();
    await e.add(...times(5, G), R, B);
    expect(await e.totals()).toMatchObject({ consumed: 1, remaining: 4, activeReds: 0, activeBlacks: 1, potentialEgp: 1000 });
  }, 120000);

  it.each([
    ['Greens first', [...times(7, G), R, B]],
    ['penalties first', [B, R, ...times(7, G)]],
    ['mixed', [G, B, G, G, R, G, G, G, G]],
  ])('G5 — 7 Greens, 1 Red, 1 Black (%s): 1 Green remains, Fund 1,000', async (_label, order) => {
    const e = await employee();
    await e.add(...(order as PointType[]));
    expect(await e.totals()).toMatchObject({ consumed: 6, remaining: 1, activeReds: 0, activeBlacks: 0, fundEgp: 1000, potentialEgp: 0 });
  }, 120000);

  it('G7 — G1 plus admin reverses an Early Green used by a Black group: group undone, re-matched, nothing deleted', async () => {
    const e = await employee();
    const early = await e.add(...times(5, G), R, W, ...times(5, G), B, ...times(3, G), W, R, ...times(4, G), W, B, ...times(3, G), W, R, W);
    await e.add(...times(10, G));
    const rowsBefore = await prisma.pointOffsetAllocation.count({ where: { companyId: e.companyId } });

    const inBlackGroup = await prisma.pointOffsetAllocation.findFirstOrThrow({
      where: { companyId: e.companyId, ...ACTIVE, penaltyEntry: { pointType: B }, greenEntryId: { in: early } },
    });
    const groupSize = await prisma.pointOffsetAllocation.count({
      where: { companyId: e.companyId, ...ACTIVE, penaltyEntryId: inBlackGroup.penaltyEntryId },
    });
    await e.reverse(inBlackGroup.greenEntryId);

    // the reversed Green is gone, everything else is re-matched: 29 Greens − 13 consumed = 16
    expect(await e.totals()).toEqual({
      greens: 29, whites: 5, consumed: 13, remaining: 16, activeReds: 0, activeBlacks: 0,
      fundEgp: 16000, potentialEgp: 0,
    });
    // a reversal row and one UNDO row per member of the group exist; no row was removed
    await expect(prisma.pointLedgerEntry.count({ where: { reversesEntryId: inBlackGroup.greenEntryId } })).resolves.toBe(1);
    await expect(
      prisma.pointOffsetAllocation.count({ where: { companyId: e.companyId, reversesAllocationId: { not: null } } }),
    ).resolves.toBe(groupSize);
    expect(await prisma.pointOffsetAllocation.count({ where: { companyId: e.companyId } })).toBeGreaterThan(rowsBefore);
  }, 120000);

  it('G8 — Reds before Blacks: 1 Black + 1 Red outstanding, 5 Greens in one run ⇒ Red cancelled, 4 left, Black active', async () => {
    const e = await employee();
    await e.add(B, R);
    await e.addMany(G, 5); // one entry ⇒ one engine run sees all 5 Greens
    expect(await e.totals()).toMatchObject({ consumed: 1, remaining: 4, activeReds: 0, activeBlacks: 1, fundEgp: 4000 });
  }, 120000);
});
