import { Injectable, Logger } from "@nestjs/common";
import { PointType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type Bucket = { id: string; remaining: number };

export type PlannedAllocation = {
  greenEntryId: string;
  penaltyEntryId: string;
  quantity: number; // green points spent
};

export type AllocationResult = {
  message: string;
  greensSpent: number;
  redsCleared: number;
  blacksCleared: number;
  offsets: PlannedAllocation[];
};
type Buckets = { greens: Bucket[]; reds: Bucket[]; blacks: Bucket[] };

// greens needed to clear ONE penalty point
const RATIO = { RED: 1, BLACK: 5 } as const;

@Injectable()
export class PointAllocationService {
  private readonly logger = new Logger(PointAllocationService.name);

  constructor(private readonly prismaService: PrismaService) {}

  private allocatePoints(
    greens: Bucket[],
    penalties: Bucket[],
    ratio: number,
    out: Map<string, PlannedAllocation>,
  ): void {
    let g = 0;

    for (const p of penalties) {
      const availableGreens = greens.reduce((s, x) => s + x.remaining, 0);
      const affordableUnits = Math.floor(availableGreens / ratio);
      const units = Math.min(p.remaining, affordableUnits);
      if (units === 0) return;

      let need = units * ratio;

      while (need > 0) {
        const green = greens[g];
        if (green.remaining === 0) {
          g++;
          continue;
        }

        const take = Math.min(green.remaining, need);
        green.remaining -= take;
        need -= take;

        const key = `${green.id}:${p.id}`;
        const existing = out.get(key);
        if (existing) existing.quantity += take;
        else
          out.set(key, {
            greenEntryId: green.id,
            penaltyEntryId: p.id,
            quantity: take,
          });
      }
    }
  }

  private async preparePoints(
    tx: Prisma.TransactionClient,
    companyId: string,
    employeeId: string,
  ): Promise<Buckets> {
    const entries = await tx.pointLedgerEntry.findMany({
      where: {
        companyId,
        employeeId,
        reversesEntryId: null,
        reversalEntries: { none: {} },
      },
      orderBy: { createdAt: "asc" },
      include: {
        greenAllocations: { select: { quantity: true } },
        penaltyAllocations: { select: { quantity: true } },
      },
    });

    const greens: Bucket[] = [];
    const reds: Bucket[] = [];
    const blacks: Bucket[] = [];

    for (const e of entries) {
      if (e.pointType === PointType.GREEN) {
        const spent = e.greenAllocations.reduce((s, a) => s + a.quantity, 0);
        const remaining = e.quantity - spent;
        if (remaining > 0) greens.push({ id: e.id, remaining });
        continue;
      }

      const ratio = RATIO[e.pointType as keyof typeof RATIO];
      if (!ratio) continue; // unknown type, ignore

      const greensUsed = e.penaltyAllocations.reduce(
        (s, a) => s + a.quantity,
        0,
      );
      const remaining = e.quantity - Math.floor(greensUsed / ratio);
      if (remaining <= 0) continue;

      (e.pointType === PointType.RED ? reds : blacks).push({
        id: e.id,
        remaining,
      });
    }

    return { greens, reds, blacks };
  }

  planOffsets(
    greens: Bucket[],
    reds: Bucket[],
    blacks: Bucket[],
  ): PlannedAllocation[] {
    const out = new Map<string, PlannedAllocation>();
    const pool = greens.map((x) => ({ ...x }));

    this.allocatePoints(pool, reds, RATIO.RED, out);
    this.allocatePoints(pool, blacks, RATIO.BLACK, out);

    return [...out.values()];
  }

  async saveAllocations(companyId: string, employeeId: string) {
    try {
      return await this.prismaService.$transaction(
        async (tx: Prisma.TransactionClient) => {
          await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;

          const { greens, reds, blacks } = await this.preparePoints(
            tx,
            companyId,
            employeeId,
          );
          const offsets = this.planOffsets(greens, reds, blacks);

          for (const offset of offsets) {
            await tx.pointOffsetAllocation.upsert({
              where: {
                greenEntryId_penaltyEntryId: {
                  greenEntryId: offset.greenEntryId,
                  penaltyEntryId: offset.penaltyEntryId,
                },
              },
              create: {
                companyId,
                greenEntryId: offset.greenEntryId,
                penaltyEntryId: offset.penaltyEntryId,
                quantity: offset.quantity,
              },
              update: { quantity: { increment: offset.quantity } },
            });
          }

          return this.buildMessage(offsets, reds, blacks);
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to save point allocations for employee ${employeeId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  private buildMessage(
    offsets: PlannedAllocation[],
    reds: Bucket[],
    blacks: Bucket[],
  ): AllocationResult {
    const redIds = new Set(reds.map((r) => r.id));
    const blackIds = new Set(blacks.map((b) => b.id));

    let redsCleared = 0;
    let greensOnBlacks = 0;

    for (const o of offsets) {
      if (redIds.has(o.penaltyEntryId))
        redsCleared += o.quantity; // 1 green : 1 red
      else if (blackIds.has(o.penaltyEntryId)) greensOnBlacks += o.quantity;
    }

    const blacksCleared = greensOnBlacks / RATIO.BLACK; // always whole, planner guarantees it
    const greensSpent = redsCleared + greensOnBlacks;

    let message: string;
    if (offsets.length === 0) {
      message =
        "No points were offset. There are either no penalties or not enough green points.";
    } else {
      const parts: string[] = [];
      if (redsCleared > 0) parts.push(`${redsCleared} red point(s)`);
      if (blacksCleared > 0) parts.push(`${blacksCleared} black point(s)`);
      message = `${greensSpent} green point(s) used to offset ${parts.join(" and ")}.`;
    }

    return { message, greensSpent, redsCleared, blacksCleared, offsets };
  }
}
