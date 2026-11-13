import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PointType, PointValueVersion, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ConfigurePointValuesDto } from "./dto/configure-point-values.dto";
import { CreatePointEntryDto } from "./dto/create-point-entry.dto";
import { ListPointEntriesQueryDto } from "./dto/list-point-entries-query.dto";
import { ReversePointEntryDto } from "./dto/reverse-point-entry.dto";
import { resolvePointValue } from "./point-value";

const VALUED_POINT_TYPES = [
  PointType.GREEN,
  PointType.RED,
  PointType.BLACK,
] as const;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export type PointEntrySource = "ADMIN" | "ATTENDANCE" | "OVERTIME";

export type AddPointEntryForSourceInput = {
  companyId: string;
  employeeId: string;
  pointType: PointType;
  quantity: number;
  sourceType: PointEntrySource;
  sourceId?: string | null;
  idempotencyKey: string;
  reason: string;
  createdByUserId?: string | null;
  asOfDate: Date;
};

export type ReversePointEntryForSourceInput = {
  companyId: string;
  entryId: string;
  reason: string;
  createdByUserId?: string | null;
};

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  getPointValues(companyId: string) {
    return this.prisma.pointValueVersion.findMany({
      where: { companyId },
      orderBy: [{ pointType: "asc" }, { effectiveFrom: "desc" }],
      include: {
        createdBy: { select: { id: true, email: true } },
      },
    });
  }

  async configurePointValues(
    companyId: string,
    adminUserId: string,
    dto: ConfigurePointValuesDto,
  ) {
    const effectiveFrom = parseDateOnly(dto.effectiveFrom);
    const values: Record<(typeof VALUED_POINT_TYPES)[number], number> = {
      [PointType.GREEN]: dto.greenEgp,
      [PointType.RED]: dto.redEgp,
      [PointType.BLACK]: dto.blackEgp,
    };

    return this.prisma.$transaction(
      async (tx) => {
        const configured: PointValueVersion[] = [];

        for (const pointType of VALUED_POINT_TYPES) {
          const sameDate = await tx.pointValueVersion.findUnique({
            where: {
              companyId_pointType_effectiveFrom: {
                companyId,
                pointType,
                effectiveFrom,
              },
            },
          });
          const laterVersion = await tx.pointValueVersion.findFirst({
            where: {
              companyId,
              pointType,
              effectiveFrom: { gt: effectiveFrom },
            },
            select: { id: true },
          });
          if (laterVersion) {
            throw new ConflictException(
              `A later ${pointType} value is already scheduled.`,
            );
          }

          const previous = await tx.pointValueVersion.findFirst({
            where: {
              companyId,
              pointType,
              effectiveFrom: { lt: effectiveFrom },
            },
            orderBy: { effectiveFrom: "desc" },
          });
          const value = new Prisma.Decimal(values[pointType]);
          let version: PointValueVersion;

          if (sameDate) {
            version = await tx.pointValueVersion.update({
              where: { id: sameDate.id },
              data: { value },
            });
          } else {
            if (
              previous &&
              (!previous.effectiveTo || previous.effectiveTo >= effectiveFrom)
            ) {
              await tx.pointValueVersion.update({
                where: { id: previous.id },
                data: { effectiveTo: previousDate(effectiveFrom) },
              });
            }

            version = await tx.pointValueVersion.create({
              data: {
                companyId,
                pointType,
                value,
                effectiveFrom,
                createdByUserId: adminUserId,
              },
            });
          }

          await tx.auditEvent.create({
            data: {
              companyId,
              actorUserId: adminUserId,
              actorType: "ADMIN",
              action: "point.value.configure",
              targetType: "POINT_VALUE_VERSION",
              targetId: version.id,
              changes: {
                pointType,
                beforeEgp:
                  sameDate?.value.toString() ??
                  previous?.value.toString() ??
                  null,
                afterEgp: value.toFixed(2),
                effectiveFrom: dto.effectiveFrom,
              },
            },
          });
          configured.push(version);
        }

        return configured;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  listPointEntries(companyId: string, query: ListPointEntriesQueryDto) {
    return this.prisma.pointLedgerEntry
      .findMany({
        where: {
          companyId,
          ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        include: {
          employee: {
            select: { id: true, employeeNumber: true, fullName: true },
          },
          pointValueVersion: true,
          greenAllocations: true,
          penaltyAllocations: true,
          createdBy: { select: { id: true, email: true } },
        },
      })
      .then((entries) => entries.map(serializePointEntry));
  }

  async addPointEntry(
    companyId: string,
    adminUserId: string,
    dto: CreatePointEntryDto,
    idempotencyKey?: string,
  ) {
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException("A reason is required to add a point.");
    }
    const key = validateIdempotencyKey(idempotencyKey);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const priorRequest = await tx.pointLedgerEntry.findUnique({
            where: { idempotencyKey: key },
          });
          if (priorRequest) {
            assertSameAward(priorRequest, companyId, dto, reason);
            return serializePointEntry(priorRequest);
          }

          const employee = await tx.employee.findFirst({
            where: { id: dto.employeeId, companyId },
            select: { id: true },
          });
          if (!employee) {
            throw new NotFoundException("Employee not found");
          }

          const { pointValueVersionId, valuePerPointPiasters } =
            await resolvePointValue(
              tx,
              companyId,
              dto.pointType,
              cairoDateOnly(new Date()),
            );
          const entry = await tx.pointLedgerEntry.create({
            data: {
              companyId,
              employeeId: employee.id,
              pointType: dto.pointType,
              entryKind: "AWARD",
              direction: 1,
              quantity: dto.quantity,
              pointValueVersionId,
              valuePerPointPiasters,
              sourceType: "ADMIN",
              idempotencyKey: key,
              reason,
              createdByUserId: adminUserId,
            },
          });

          await tx.auditEvent.create({
            data: {
              companyId,
              actorUserId: adminUserId,
              actorType: "ADMIN",
              action: "point.award",
              targetType: "POINT_LEDGER_ENTRY",
              targetId: entry.id,
              reason,
              changes: {
                pointType: dto.pointType,
                quantity: dto.quantity,
                valuePerPointPiasters: valuePerPointPiasters.toString(),
              },
            },
          });
          return serializePointEntry(entry);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await this.prisma.pointLedgerEntry.findUnique({
          where: { idempotencyKey: key },
        });
        if (existing) {
          assertSameAward(existing, companyId, dto, reason);
          return serializePointEntry(existing);
        }
        throw new ConflictException("Point entry already has a reversal.");
      }
      throw error;
    }
  }

  /**
   * Appends an award for any ledger source. Use the optional transaction to
   * commit the award atomically with its attendance or other source record.
   */
  async addPointEntryForSource(
    input: AddPointEntryForSourceInput,
    transaction?: Prisma.TransactionClient,
  ) {
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException("A reason is required to add a point.");
    }
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 100000
    ) {
      throw new BadRequestException(
        "Point quantity must be an integer between 1 and 100000.",
      );
    }
    if (Number.isNaN(input.asOfDate.getTime())) {
      throw new BadRequestException("A valid point-value date is required.");
    }
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const normalized = { ...input, reason, idempotencyKey };

    try {
      if (transaction) {
        return serializePointEntry(
          await this.createSourceAward(transaction, normalized),
        );
      }

      const entry = await this.prisma.$transaction(
        (tx) => this.createSourceAward(tx, normalized),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return serializePointEntry(entry);
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      if (transaction) {
        throw new ConflictException(
          "Point entry conflicts with an existing ledger entry.",
        );
      }

      const existing = await this.prisma.pointLedgerEntry.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        assertSameSourceAward(existing, normalized);
        return serializePointEntry(existing);
      }
      throw new ConflictException(
        "Point entry conflicts with an existing ledger entry.",
      );
    }
  }

  /**
   * Appends one compensating reversal for an award. The original ledger row
   * remains immutable; pass a transaction to include this in a parent action.
   */
  async reversePointEntryForSource(
    input: ReversePointEntryForSourceInput,
    transaction?: Prisma.TransactionClient,
  ) {
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException("A reason is required to reverse a point.");
    }

    try {
      if (transaction) {
        return serializePointEntry(
          await this.createSourceReversal(transaction, { ...input, reason }),
        );
      }

      const reversal = await this.prisma.$transaction(
        (tx) => this.createSourceReversal(tx, { ...input, reason }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return serializePointEntry(reversal);
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      if (transaction) {
        throw new ConflictException("Point entry has already been reversed.");
      }

      const existing = await this.prisma.pointLedgerEntry.findUnique({
        where: { reversesEntryId: input.entryId },
      });
      if (existing?.reason === reason) {
        return serializePointEntry(existing);
      }
      throw new ConflictException("Point entry has already been reversed.");
    }
  }

  private async createSourceAward(
    tx: Prisma.TransactionClient,
    input: AddPointEntryForSourceInput & {
      reason: string;
      idempotencyKey: string;
    },
  ) {
    const existing = await tx.pointLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      assertSameSourceAward(existing, input);
      return existing;
    }

    const employee = await tx.employee.findFirst({
      where: { id: input.employeeId, companyId: input.companyId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException("Employee not found");
    }

    const pointValue = await resolvePointValue(
      tx,
      input.companyId,
      input.pointType,
      input.asOfDate,
    );
    return tx.pointLedgerEntry.create({
      data: {
        companyId: input.companyId,
        employeeId: employee.id,
        pointType: input.pointType,
        entryKind: "AWARD",
        direction: 1,
        quantity: input.quantity,
        ...pointValue,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  private async createSourceReversal(
    tx: Prisma.TransactionClient,
    input: ReversePointEntryForSourceInput & { reason: string },
  ) {
    const entry = await tx.pointLedgerEntry.findFirst({
      where: {
        id: input.entryId,
        companyId: input.companyId,
        entryKind: "AWARD",
      },
    });
    if (!entry) {
      throw new NotFoundException("Reversible point entry not found");
    }

    const existing = await tx.pointLedgerEntry.findUnique({
      where: { reversesEntryId: entry.id },
    });
    if (existing) {
      if (existing.reason === input.reason) {
        return existing;
      }
      throw new ConflictException("Point entry has already been reversed.");
    }

    return tx.pointLedgerEntry.create({
      data: {
        companyId: entry.companyId,
        employeeId: entry.employeeId,
        pointType: entry.pointType,
        entryKind: "REVERSAL",
        direction: -1,
        quantity: entry.quantity,
        pointValueVersionId: entry.pointValueVersionId,
        valuePerPointPiasters: entry.valuePerPointPiasters,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        idempotencyKey: `source-reversal:${entry.id}`,
        reversesEntryId: entry.id,
        reason: input.reason,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  async reversePointEntry(
    companyId: string,
    adminUserId: string,
    entryId: string,
    dto: ReversePointEntryDto,
  ) {
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException("A reason is required to reverse a point.");
    }

    try {
      const reversal = await this.prisma.$transaction(
        async (tx) => {
          const entry = await tx.pointLedgerEntry.findFirst({
            where: { id: entryId, companyId },
          });
          if (
            !entry ||
            entry.sourceType !== "ADMIN" ||
            entry.entryKind !== "AWARD"
          ) {
            throw new NotFoundException(
              "Reversible admin point entry not found",
            );
          }

          const existingReversal = await tx.pointLedgerEntry.findUnique({
            where: { reversesEntryId: entry.id },
          });
          if (existingReversal) {
            if (existingReversal.reason === reason) {
              return existingReversal;
            }
            throw new ConflictException(
              "Point entry has already been reversed.",
            );
          }

          const reversal = await tx.pointLedgerEntry.create({
            data: {
              companyId,
              employeeId: entry.employeeId,
              pointType: entry.pointType,
              entryKind: "REVERSAL",
              direction: -1,
              quantity: entry.quantity,
              pointValueVersionId: entry.pointValueVersionId,
              valuePerPointPiasters: entry.valuePerPointPiasters,
              sourceType: "ADMIN",
              sourceId: entry.id,
              idempotencyKey: `admin-reversal:${entry.id}`,
              reversesEntryId: entry.id,
              reason,
              createdByUserId: adminUserId,
            },
          });

          await tx.auditEvent.create({
            data: {
              companyId,
              actorUserId: adminUserId,
              actorType: "ADMIN",
              action: "point.reverse",
              targetType: "POINT_LEDGER_ENTRY",
              targetId: reversal.id,
              reason,
              changes: {
                reversesEntryId: entry.id,
                pointType: entry.pointType,
                quantity: entry.quantity,
              },
            },
          });
          return reversal;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return serializePointEntry(reversal);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await this.prisma.pointLedgerEntry.findUnique({
          where: { reversesEntryId: entryId },
        });
        if (existing?.reason === reason) {
          return serializePointEntry(existing);
        }
        throw new ConflictException("Point entry has already been reversed.");
      }
      throw error;
    }
  }
}

function assertSameSourceAward(
  existing: {
    companyId: string;
    employeeId: string;
    pointType: PointType;
    quantity: number;
    reason: string | null;
    entryKind: string;
    sourceType: string;
    sourceId: string | null;
    direction: number;
  },
  input: AddPointEntryForSourceInput & {
    reason: string;
    idempotencyKey: string;
  },
) {
  if (
    existing.companyId !== input.companyId ||
    existing.employeeId !== input.employeeId ||
    existing.pointType !== input.pointType ||
    existing.quantity !== input.quantity ||
    existing.reason !== input.reason ||
    existing.entryKind !== "AWARD" ||
    existing.sourceType !== input.sourceType ||
    existing.sourceId !== (input.sourceId ?? null) ||
    existing.direction !== 1
  ) {
    throw new ConflictException(
      "Idempotency key was already used for a different point entry.",
    );
  }
}

function serializePointEntry<T extends { valuePerPointPiasters: bigint }>(
  entry: T,
) {
  return {
    ...entry,
    valuePerPointPiasters: entry.valuePerPointPiasters.toString(),
  };
}

function assertSameAward(
  existing: {
    companyId: string;
    employeeId: string;
    pointType: PointType;
    quantity: number;
    reason: string | null;
    entryKind: string;
    sourceType: string;
    direction: number;
  },
  companyId: string,
  dto: CreatePointEntryDto,
  reason: string,
) {
  if (
    existing.companyId !== companyId ||
    existing.employeeId !== dto.employeeId ||
    existing.pointType !== dto.pointType ||
    existing.quantity !== dto.quantity ||
    existing.reason !== reason ||
    existing.entryKind !== "AWARD" ||
    existing.sourceType !== "ADMIN" ||
    existing.direction !== 1
  ) {
    throw new ConflictException(
      "Idempotency-Key was already used for a different point entry.",
    );
  }
}

function validateIdempotencyKey(value?: string) {
  const key = value?.trim();
  if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException(
      `Idempotency-Key header is required and must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
    );
  }
  return key;
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(
      "effectiveFrom must be a valid YYYY-MM-DD date.",
    );
  }
  return date;
}

function cairoDateOnly(value: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") =>
    Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

function previousDate(value: Date) {
  const prior = new Date(value);
  prior.setUTCDate(prior.getUTCDate() - 1);
  return prior;
}
