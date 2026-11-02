import { BadRequestException } from '@nestjs/common';
import { PointType, Prisma } from '@prisma/client';

// Snapshot of a point's money value on a date; WHITE is visibility only (0).
export async function resolvePointValue(
  tx: Prisma.TransactionClient,
  companyId: string,
  pointType: PointType,
  asOfDate: Date,
) {
  if (pointType === PointType.WHITE) {
    return { pointValueVersionId: null, valuePerPointPiasters: 0n };
  }
  const version = await tx.pointValueVersion.findFirst({
    where: {
      companyId,
      pointType,
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!version) {
    throw new BadRequestException(
      `No ${pointType} value is configured for ${asOfDate.toISOString().slice(0, 10)}.`,
    );
  }
  return {
    pointValueVersionId: version.id,
    valuePerPointPiasters: BigInt(version.value.mul(100).toFixed(0)),
  };
}
