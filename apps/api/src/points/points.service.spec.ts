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
