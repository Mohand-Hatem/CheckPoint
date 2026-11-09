import 'reflect-metadata';
import { PointType, Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigurePointValuesDto } from './dto/configure-point-values.dto';
import { CreatePointEntryDto } from './dto/create-point-entry.dto';
import { ReversePointEntryDto } from './dto/reverse-point-entry.dto';
import { PointsService } from './points.service';

describe('PointsService', () => {
  const companyId = 'c0ffee00-0000-4000-8000-000000000001';
  const adminUserId = 'c0ffee00-0000-4000-8000-000000000002';
  const employeeId = 'c0ffee00-0000-4000-8000-000000000003';
  const entryId = 'c0ffee00-0000-4000-8000-000000000004';
  const idempotencyKey = 'test-point-award-1';

  function createService(tx: Record<string, unknown>) {
    const prisma = {
      $transaction: jest.fn(
        async (operation: (transaction: typeof tx) => Promise<unknown>) =>
          operation(tx),
      ),
      pointLedgerEntry: { findUnique: jest.fn() },
    };
    return new PointsService(prisma as unknown as PrismaService);
  }

  it('TEST-PTS-01 (FR-PTS-1): appends an award with the configured EGP snapshot', async () => {
    const entry = {
      id: entryId,
      companyId,
      employeeId,
      pointType: PointType.GREEN,
      entryKind: 'AWARD',
      quantity: 2,
      reason: 'Approved recognition',
      valuePerPointPiasters: 1725n,
    };
    const tx = {
      pointLedgerEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(entry),
      },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: employeeId }) },
      pointValueVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'c0ffee00-0000-4000-8000-000000000005',
          value: new Prisma.Decimal('17.25'),
        }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = createService(tx);
    const dto: CreatePointEntryDto = {
      employeeId,
      pointType: PointType.GREEN,
      quantity: 2,
      reason: '  Approved recognition  ',
    };

    await expect(
      service.addPointEntry(companyId, adminUserId, dto, idempotencyKey),
    ).resolves.toEqual({ ...entry, valuePerPointPiasters: '1725' });

    expect(tx.pointLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 1,
          valuePerPointPiasters: 1725n,
          reason: 'Approved recognition',
        }),
      }),
    );
    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'point.award',
          reason: 'Approved recognition',
        }),
      }),
    );
  });

  it('TEST-PTS-02 (FR-PTS-5): appends an auditable reversal without changing its award', async () => {
    const award = {
      id: entryId,
      companyId,
      employeeId,
      pointType: PointType.RED,
      entryKind: 'AWARD',
      quantity: 1,
      sourceType: 'ADMIN',
      pointValueVersionId: 'c0ffee00-0000-4000-8000-000000000005',
      valuePerPointPiasters: 25000n,
    };
    const reversal = {
      id: 'c0ffee00-0000-4000-8000-000000000006',
      entryKind: 'REVERSAL',
      reason: 'Incorrectly entered',
      direction: -1,
      valuePerPointPiasters: 25000n,
    };
    const tx = {
      pointLedgerEntry: {
        findFirst: jest.fn().mockResolvedValue(award),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(reversal),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = createService(tx);
    const dto: ReversePointEntryDto = { reason: '  Incorrectly entered  ' };

    await expect(
      service.reversePointEntry(companyId, adminUserId, entryId, dto),
    ).resolves.toEqual({ ...reversal, valuePerPointPiasters: '25000' });

    expect(tx.pointLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reversesEntryId: entryId,
          direction: -1,
          valuePerPointPiasters: 25000n,
          reason: 'Incorrectly entered',
        }),
      }),
    );
    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'point.reverse',
          reason: 'Incorrectly entered',
        }),
      }),
    );
  });

  it('records an attendance award in the caller transaction with an idempotency key', async () => {
    const entry = {
      id: entryId,
      companyId,
      employeeId,
      pointType: PointType.GREEN,
      entryKind: 'AWARD',
      quantity: 1,
      reason: 'Attendance check-in',
      sourceType: 'ATTENDANCE',
      sourceId: 'c0ffee00-0000-4000-8000-000000000007',
      direction: 1,
      valuePerPointPiasters: 100000n,
    };
    const tx = {
      pointLedgerEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(entry),
      },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: employeeId }) },
      pointValueVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'value-green',
          value: new Prisma.Decimal('1000'),
        }),
      },
    } as Record<string, any>;
    const service = createService(tx);

    await expect(
      service.addPointEntryForSource(
        {
          companyId,
          employeeId,
          pointType: PointType.GREEN,
          quantity: 1,
          sourceType: 'ATTENDANCE',
          sourceId: entry.sourceId,
          idempotencyKey: 'attendance:day-1:check-in',
          reason: 'Attendance check-in',
          asOfDate: new Date('2026-11-08T00:00:00.000Z'),
        },
        tx as unknown as Prisma.TransactionClient,
      ),
    ).resolves.toMatchObject({
      id: entryId,
      valuePerPointPiasters: '100000',
    });

    expect(tx.pointLedgerEntry.create.mock.calls[0][0].data).toMatchObject({
      sourceType: 'ATTENDANCE',
      sourceId: entry.sourceId,
      idempotencyKey: 'attendance:day-1:check-in',
      createdByUserId: null,
    });
  });

  it('opens a transaction when recording an automatic award without a client', async () => {
    const tx = {
      pointLedgerEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: entryId,
          valuePerPointPiasters: 0n,
        }),
      },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: employeeId }) },
      pointValueVersion: { findFirst: jest.fn() },
    };
    const service = createService(tx);

    await service.addPointEntryForSource({
      companyId,
      employeeId,
      pointType: PointType.WHITE,
      quantity: 1,
      sourceType: 'ATTENDANCE',
      sourceId: entryId,
      idempotencyKey: 'attendance:white:1',
      reason: 'Attendance visibility record',
      asOfDate: new Date('2026-11-08T00:00:00.000Z'),
    });

    expect(tx.pointLedgerEntry.create).toHaveBeenCalledTimes(1);
    expect(tx.pointValueVersion.findFirst).not.toHaveBeenCalled();
  });

  it('replays the same automatic award for a repeated idempotency key', async () => {
    const existing = {
      id: entryId,
      companyId,
      employeeId,
      pointType: PointType.GREEN,
      quantity: 1,
      reason: 'Attendance check-in',
      entryKind: 'AWARD',
      sourceType: 'ATTENDANCE',
      sourceId: 'c0ffee00-0000-4000-8000-000000000007',
      direction: 1,
      valuePerPointPiasters: 100000n,
    };
    const tx = {
      pointLedgerEntry: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
      employee: { findFirst: jest.fn() },
      pointValueVersion: { findFirst: jest.fn() },
    } as Record<string, any>;
    const service = createService(tx);

    await expect(
      service.addPointEntryForSource(
        {
          companyId,
          employeeId,
          pointType: PointType.GREEN,
          quantity: 1,
          sourceType: 'ATTENDANCE',
          sourceId: existing.sourceId,
          idempotencyKey: idempotencyKey,
          reason: existing.reason,
          asOfDate: new Date('2026-11-08T00:00:00.000Z'),
        },
        tx as unknown as Prisma.TransactionClient,
      ),
    ).resolves.toMatchObject({ id: entryId });
    expect(tx.pointLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('reverses an automatic award by appending a linked compensating row', async () => {
    const award = {
      id: entryId,
      companyId,
      employeeId,
      pointType: PointType.GREEN,
      entryKind: 'AWARD',
      quantity: 2,
      sourceType: 'OVERTIME',
      sourceId: 'c0ffee00-0000-4000-8000-000000000007',
      pointValueVersionId: 'c0ffee00-0000-4000-8000-000000000005',
      valuePerPointPiasters: 100000n,
    };
    const reversal = {
      id: 'c0ffee00-0000-4000-8000-000000000006',
      entryKind: 'REVERSAL',
      direction: -1,
      quantity: 2,
      valuePerPointPiasters: 100000n,
    };
    const tx = {
      pointLedgerEntry: {
        findFirst: jest.fn().mockResolvedValue(award),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(reversal),
      },
    } as Record<string, any>;
    const service = createService(tx);

    await expect(
      service.reversePointEntryForSource(
        {
          companyId,
          entryId,
          reason: '  Correcting check-out  ',
          createdByUserId: adminUserId,
        },
        tx as unknown as Prisma.TransactionClient,
      ),
    ).resolves.toMatchObject({
      entryKind: 'REVERSAL',
      valuePerPointPiasters: '100000',
    });

    expect(tx.pointLedgerEntry.create.mock.calls[0][0].data).toMatchObject({
      sourceType: 'OVERTIME',
      sourceId: award.sourceId,
      reversesEntryId: entryId,
      idempotencyKey: `source-reversal:${entryId}`,
      reason: 'Correcting check-out',
      direction: -1,
      quantity: 2,
    });
  });

  it('TEST-PTS-03 (FR-PTS-7): rejects non-positive configured EGP values', async () => {
    const dto = Object.assign(new ConfigurePointValuesDto(), {
      greenEgp: 0,
      redEgp: -1,
      blackEgp: 1000.005,
      effectiveFrom: '2026-11-01',
    });

    const errors = await validate(dto);

    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['greenEgp', 'redEgp', 'blackEgp']),
    );
  });
});
