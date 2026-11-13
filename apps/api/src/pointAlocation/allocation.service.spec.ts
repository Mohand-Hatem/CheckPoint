import { PointType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { Bucket, PointAllocationService } from "./allocation.service";

describe("PointAllocationService", () => {
  const companyId = "company-1";
  const employeeId = "employee-1";

  it("TEST-ALLOC-01 (FR-PTS-2): plans FIFO offsets, clearing RED penalties before BLACK penalties", () => {
    const service = new PointAllocationService({} as PrismaService);
    const greens: Bucket[] = [
      { id: "green-1", remaining: 2 },
      { id: "green-2", remaining: 5 },
    ];

    expect(
      service.planOffsets(
        greens,
        [{ id: "red-1", remaining: 1 }],
        [{ id: "black-1", remaining: 1 }],
      ),
    ).toEqual([
      { greenEntryId: "green-1", penaltyEntryId: "red-1", quantity: 1 },
      { greenEntryId: "green-1", penaltyEntryId: "black-1", quantity: 1 },
      { greenEntryId: "green-2", penaltyEntryId: "black-1", quantity: 4 },
    ]);

    expect(greens).toEqual([
      { id: "green-1", remaining: 2 },
      { id: "green-2", remaining: 5 },
    ]);
  });

  it("TEST-ALLOC-02 (FR-PTS-2): does not partially spend GREEN points on an unaffordable BLACK penalty", () => {
    const service = new PointAllocationService({} as PrismaService);

    expect(
      service.planOffsets(
        [{ id: "green-1", remaining: 4 }],
        [],
        [{ id: "black-1", remaining: 1 }],
      ),
    ).toEqual([]);
  });

  it("TEST-ALLOC-03 (FR-PTS-2/3): persists planned offsets in a transaction and returns allocation totals", async () => {
    const entries = [
      {
        id: "green-1",
        pointType: PointType.GREEN,
        quantity: 3,
        greenAllocations: [],
        penaltyAllocations: [],
      },
      {
        id: "red-1",
        pointType: PointType.RED,
        quantity: 1,
        greenAllocations: [],
        penaltyAllocations: [],
      },
      {
        id: "black-1",
        pointType: PointType.BLACK,
        quantity: 1,
        greenAllocations: [],
        penaltyAllocations: [],
      },
    ];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      pointLedgerEntry: {
        findMany: jest.fn().mockResolvedValue(entries),
      },
      pointOffsetAllocation: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (operation: (transaction: Prisma.TransactionClient) => unknown) =>
          operation(tx as unknown as Prisma.TransactionClient),
      ),
    };
    const service = new PointAllocationService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.saveAllocations(companyId, employeeId),
    ).resolves.toMatchObject({
      greensSpent: 1,
      redsCleared: 1,
      blacksCleared: 0,
      message: "1 green point(s) used to offset 1 red point(s).",
    });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.pointLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId,
          employeeId,
          reversesEntryId: null,
          reversalEntries: { none: {} },
        },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(tx.pointOffsetAllocation.upsert).toHaveBeenCalledWith({
      where: {
        greenEntryId_penaltyEntryId: {
          greenEntryId: "green-1",
          penaltyEntryId: "red-1",
        },
      },
      create: {
        companyId,
        greenEntryId: "green-1",
        penaltyEntryId: "red-1",
        quantity: 1,
      },
      update: { quantity: { increment: 1 } },
    });
  });

  it("TEST-ALLOC-04 (FR-PTS-2): returns a no-offset message and does not write when no penalty can be cleared", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      pointLedgerEntry: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "green-1",
            pointType: PointType.GREEN,
            quantity: 4,
            greenAllocations: [],
            penaltyAllocations: [],
          },
          {
            id: "black-1",
            pointType: PointType.BLACK,
            quantity: 1,
            greenAllocations: [],
            penaltyAllocations: [],
          },
        ]),
      },
      pointOffsetAllocation: { upsert: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        async (operation: (transaction: Prisma.TransactionClient) => unknown) =>
          operation(tx as unknown as Prisma.TransactionClient),
      ),
    };
    const service = new PointAllocationService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.saveAllocations(companyId, employeeId),
    ).resolves.toMatchObject({
      greensSpent: 0,
      redsCleared: 0,
      blacksCleared: 0,
      offsets: [],
      message:
        "No points were offset. There are either no penalties or not enough green points.",
    });
    expect(tx.pointOffsetAllocation.upsert).not.toHaveBeenCalled();
  });
});
