/**
 * Parallel point writes for one employee (05 §14 user lock, C-25; Phase 4 concurrency tests).
 * Needs a database created by `prisma migrate deploy`.
 */
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PointType } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { CheckService } from '../src/checkOperations/check.service';
import { CompanyPolicyService } from '../src/company/company-policy.service';
import { provisionCompany } from '../src/company/provision-company';
import { LocationService } from '../src/location/location.service';
import { PointAllocationService } from '../src/points/point-allocation.service';
import { PointsService } from '../src/points/points.service';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const allocation = new PointAllocationService(prisma);
const points = new PointsService(prisma, allocation);
const run = Date.now();

const setup = async (slug: string) => {
  const result = await provisionCompany(prisma, {
    name: `Concurrency ${slug} ${run}`, slug: `concurrency-${slug}-${run}`, adminEmail: `concurrency-${slug}-${run}@db.test`,
    adminPassword: 'Password123!', mustChangePassword: false,
  });
  const employeeId = (await prisma.employee.findFirstOrThrow({ where: { userId: result.adminUserId } })).id;
  return { ...result, employeeId };
};
const activeOffsets = (companyId: string) =>
  prisma.pointOffsetAllocation.findMany({ where: { companyId, reversesAllocationId: null, undoneBy: { is: null } } });

describe('Point writes in parallel (real database)', () => {
  afterAll(() => prisma.$disconnect());

  it('accepts parallel admin adds for one employee and offsets each RED exactly once', async () => {
    const { companyId, adminUserId, employeeId } = await setup('adds');
    const types = [PointType.RED, PointType.GREEN, PointType.RED, PointType.GREEN, PointType.RED, PointType.GREEN, PointType.RED, PointType.GREEN];
    const results = await Promise.allSettled(
      types.map((pointType, i) =>
        points.addPointEntry(companyId, adminUserId, { employeeId, pointType, quantity: 1, reason: 'parallel' }, `parallel-${run}-${i}`),
      ),
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);

    // 4 REDs and 4 GREENs: every RED is paid by exactly one GREEN, no GREEN is used twice.
    const offsets = await activeOffsets(companyId);
    expect(offsets).toHaveLength(4);
    expect(new Set(offsets.map((o) => o.penaltyEntryId)).size).toBe(4);
    expect(new Set(offsets.map((o) => o.greenEntryId)).size).toBe(4);
  }, 60000);

  it('reverses a point once when five reversals race (I4)', async () => {
    const { companyId, adminUserId, employeeId } = await setup('reverse');
    const red = await points.addPointEntry(companyId, adminUserId, { employeeId, pointType: PointType.RED, quantity: 1, reason: 'race' }, `reverse-${run}-red`);
    const green = await points.addPointEntry(companyId, adminUserId, { employeeId, pointType: PointType.GREEN, quantity: 1, reason: 'race' }, `reverse-${run}-green`);

    const results = await Promise.allSettled(
      [0, 1, 2, 3, 4].map((i) => points.reversePointEntry(companyId, adminUserId, green.id, { reason: i % 2 ? 'other reason' : 'same reason' })),
    );

    // The same reason replays the reversal; a different one is a clean 409. Never a 500.
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConflictException);
    }
    expect(await prisma.pointLedgerEntry.count({ where: { reversesEntryId: green.id } })).toBe(1);
    // The reversed GREEN no longer pays the RED.
    expect((await activeOffsets(companyId)).filter((o) => o.penaltyEntryId === red.id)).toEqual([]);
  }, 60000);

  describe('check-in confirm while an admin adds points', () => {
    let moduleRef: TestingModule;

    afterAll(() => moduleRef?.close());

    it('both succeed and the ledger stays consistent', async () => {
      const { companyId, adminUserId, employeeId } = await setup('confirm');
      // A shift that opened 5 minutes ago (Cairo), on a working day: the confirm classifies GREEN.
      const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .format(new Date()).split(':').map(Number);
      await prisma.shiftVersion.updateMany({
        where: { companyId },
        data: { startTime: new Date(Date.UTC(1970, 0, 1, 0, Math.max(0, h * 60 + m - 5))), endTime: new Date(Date.UTC(1970, 0, 1, 23, 59)) },
      });
      await prisma.setting.update({ where: { companyId_key: { companyId, key: 'weekly_off_days' } }, data: { value: [] } });

      moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const checks = moduleRef.get(CheckService);
      const locations = moduleRef.get(LocationService);
      const workDate = await moduleRef.get(CompanyPolicyService).getCompanyDate(companyId);

      const location = await prisma.location.create({ data: { companyId, name: 'Office', latitude: 30, longitude: 31, qrSecret: Buffer.from(`secret-${run}`) } });
      const startedAt = new Date();
      const verification = await prisma.attendanceVerification.create({
        data: { companyId, employeeId, workDate, locationId: location.id, startedAt, expiresAt: new Date(startedAt.getTime() + 15 * 60_000), latitude: 30, longitude: 31, accuracyM: 5 },
      });
      const { token } = await locations.getQrToken(companyId, location.id);
      const red = await points.addPointEntry(companyId, adminUserId, { employeeId, pointType: PointType.RED, quantity: 1, reason: 'before' }, `confirm-${run}-red`);

      const results = await Promise.allSettled([
        checks.confirmCheckIn(companyId, employeeId, verification.id, token),
        ...[0, 1, 2].map((i) =>
          points.addPointEntry(companyId, adminUserId, { employeeId, pointType: PointType.GREEN, quantity: 1, reason: 'during' }, `confirm-${run}-green-${i}`),
        ),
      ]);

      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      expect(await prisma.attendanceDay.count({ where: { companyId, employeeId, workDate } })).toBe(1);
      // 4 GREENs (the day + 3 admin) and 1 RED: the RED is paid exactly once.
      const offsets = await activeOffsets(companyId);
      expect(offsets).toEqual([expect.objectContaining({ penaltyEntryId: red.id, quantity: 1 })]);
    }, 60000);
  });
});
