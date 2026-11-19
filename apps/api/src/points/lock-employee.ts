import { Prisma } from '@prisma/client';

/**
 * User lock (05 §14): the first statement of every transaction that writes points.
 * NO KEY UPDATE, because FK inserts hold KEY SHARE on this row and a later FOR UPDATE deadlocks.
 */
export async function lockEmployee(tx: Prisma.TransactionClient, employeeId: string) {
  await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId}::uuid FOR NO KEY UPDATE`;
}
