import { PointType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { Bucket, PointAllocationService } from "./point-allocation.service";

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
        workDate: new Date("2026-01-05T00:00:00.000Z"),
        quantity: 3,
        greenAllocations: [],
        penaltyAllocations: [],
      },
      {
        id: "red-1",
        pointType: PointType.RED,
        workDate: new Date("2026-01-05T00:00:00.000Z"),
        quantity: 1,
        greenAllocations: [],
        penaltyAllocations: [],
      },
      {
        id: "black-1",
        pointType: PointType.BLACK,
        workDate: new Date("2026-01-05T00:00:00.000Z"),
        quantity: 1,
        greenAllocations: [],
        penaltyAllocations: [],
      },
    ];
    const tx = {
      payrollMonth: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      pointLedgerEntry: {
        findMany: jest.fn().mockResolvedValue(entries),
      },
      pointOffsetAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
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
        orderBy: [{ workDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
    );
    // append-only: new APPLY rows, never an update of an existing row
    expect(tx.pointOffsetAllocation.createMany).toHaveBeenCalledTimes(1);
    expect(tx.pointOffsetAllocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          companyId,
          greenEntryId: "green-1",
          penaltyEntryId: "red-1",
          quantity: 1,
        },
      ],
    });
  });

  it("TEST-ALLOC-04 (FR-PTS-2): returns a no-offset message and does not write when no penalty can be cleared", async () => {
    const tx = {
      payrollMonth: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      pointLedgerEntry: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "green-1",
            pointType: PointType.GREEN,
            workDate: new Date("2026-01-05T00:00:00.000Z"),
            quantity: 4,
            greenAllocations: [],
            penaltyAllocations: [],
          },
          {
            id: "black-1",
            pointType: PointType.BLACK,
            workDate: new Date("2026-01-05T00:00:00.000Z"),
            quantity: 1,
            greenAllocations: [],
            penaltyAllocations: [],
          },
        ]),
      },
      pointOffsetAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
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
      greensSpent: 0,
      redsCleared: 0,
      blacksCleared: 0,
      offsets: [],
      message:
        "No points were offset. There are either no penalties or not enough green points.",
    });
    expect(tx.pointOffsetAllocation.createMany).not.toHaveBeenCalled();
  });

  it("TEST-ALLOC-09 (FR-PTS-5, 05 §5.3): a reversed GREEN undoes its BLACK's whole group with UNDO rows, then re-matches", async () => {
    // BLACK-1 was cancelled by green-1 (2) + green-2 (3); green-1 is now reversed.
    const appliedRows = [
      { id: "alloc-1", greenEntryId: "green-1", penaltyEntryId: "black-1", quantity: 2 },
      { id: "alloc-2", greenEntryId: "green-2", penaltyEntryId: "black-1", quantity: 3 },
    ];
    const tx = {
      payrollMonth: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      pointOffsetAllocation: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ penaltyEntryId: "black-1" }]) // rows touching a reversed entry
          .mockResolvedValueOnce(appliedRows), // every active row of black-1
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      pointLedgerEntry: {
        // after the UNDO rows: green-2 has 3 free, black-1 is open again, green-1 is gone (reversed)
        findMany: jest.fn().mockResolvedValue([
          { id: "green-2", pointType: PointType.GREEN, workDate: new Date("2026-01-05T00:00:00.000Z"), quantity: 3, greenAllocations: [], penaltyAllocations: [] },
          { id: "black-1", pointType: PointType.BLACK, workDate: new Date("2026-01-05T00:00:00.000Z"), quantity: 1, greenAllocations: [], penaltyAllocations: [] },
        ]),
      },
    };
    const service = new PointAllocationService({} as PrismaService);

    const result = await service.saveAllocations(
      companyId,
      employeeId,
      tx as unknown as Prisma.TransactionClient,
    );

    expect(tx.pointOffsetAllocation.findMany.mock.calls[1][0].where).toMatchObject({
      penaltyEntryId: { in: ["black-1"] },
      reversesAllocationId: null,
      undoneBy: { is: null },
    });
    expect(tx.pointOffsetAllocation.createMany).toHaveBeenCalledTimes(1);
    expect(tx.pointOffsetAllocation.createMany).toHaveBeenCalledWith({
      data: [
        { companyId, greenEntryId: "green-1", penaltyEntryId: "black-1", quantity: 2, reversesAllocationId: "alloc-1" },
        { companyId, greenEntryId: "green-2", penaltyEntryId: "black-1", quantity: 3, reversesAllocationId: "alloc-2" },
      ],
    });
    // 3 Greens cannot pay a BLACK (needs 5): nothing re-applied, the BLACK stays open
    expect(result).toMatchObject({ blacksCleared: 0, offsets: [] });
  });

  it("TEST-ALLOC-10 (05 §5.3): only active rows count; UNDO rows and undone rows are filtered out", async () => {
    const tx = {
      payrollMonth: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      pointOffsetAllocation: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
      pointLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await new PointAllocationService({} as PrismaService).saveAllocations(
      companyId,
      employeeId,
      tx as unknown as Prisma.TransactionClient,
    );
    const active = { reversesAllocationId: null, undoneBy: { is: null } };
    expect(tx.pointLedgerEntry.findMany.mock.calls[0][0].include).toEqual({
      greenAllocations: { where: active, select: { quantity: true } },
      penaltyAllocations: { where: active, select: { quantity: true } },
    });
  });

  it("TEST-ALLOC-08 (FR-PTS-2): uses the provided transaction instead of opening another one", async () => {
    const tx = {
      payrollMonth: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      pointLedgerEntry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      pointOffsetAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
      },
    };
    const prisma = { $transaction: jest.fn() };
    const service = new PointAllocationService(
      prisma as unknown as PrismaService,
    );

    await service.saveAllocations(
      companyId,
      employeeId,
      tx as unknown as Prisma.TransactionClient,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    // The caller holds lockEmployee (05 §14), so the engine takes no lock of its own.
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.pointLedgerEntry.findMany).toHaveBeenCalled();
  });
});
