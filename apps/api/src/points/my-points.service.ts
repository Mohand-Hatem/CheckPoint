import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CompanyPolicyService } from '../company/company-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { MyPointsQuery } from './dto/my-points.dto';

/** The signed-in employee's own points, read from the `point_state` view (05 §5.2, C-24). */
@Injectable()
export class MyPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyPolicy: CompanyPolicyService,
  ) {}

  async list(companyId: string, userId: string, query: MyPointsQuery) {
    const { employeeId, month, monthStart } = await this.scope(companyId, userId, query.month);
    const where = Prisma.sql`company_id = ${companyId}::uuid AND employee_id = ${employeeId}::uuid
      AND payroll_month = ${monthStart}::date
      ${query.type ? Prisma.sql`AND point_type::text = ${query.type}` : Prisma.empty}`;

    const [items, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<unknown[]>`
        SELECT entry_id AS id, point_type AS "pointType", to_char(work_date, 'YYYY-MM-DD') AS "workDate",
               quantity, source_type AS "sourceType", reason, created_at AS "createdAt",
               reversed, month_locked AS "monthLocked", consumed_qty AS "consumedQty",
               cancelled_qty AS "cancelledQty", available_qty AS "availableQty",
               settled_qty AS "settledQty", active_qty AS "activeQty"
        FROM point_state WHERE ${where}
        ORDER BY work_date DESC, created_at DESC, entry_id DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total FROM point_state WHERE ${where}`,
    ]);

    return {
      month,
      items,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async summary(companyId: string, userId: string, monthParam?: string) {
    const { employeeId, month, monthStart } = await this.scope(companyId, userId, monthParam);
    const [s] = await this.prisma.$queryRaw<Record<string, number>[]>`
      SELECT
        COALESCE(SUM(quantity) FILTER (WHERE point_type = 'GREEN' AND NOT reversed), 0)::int AS green_total,
        COALESCE(SUM(available_qty) FILTER (WHERE point_type = 'GREEN'), 0)::int AS green_available,
        COALESCE(SUM(consumed_qty) FILTER (WHERE point_type = 'GREEN'), 0)::int AS green_consumed,
        COALESCE(SUM(settled_qty) FILTER (WHERE point_type = 'GREEN'), 0)::int AS green_settled,
        COALESCE(SUM(quantity) FILTER (WHERE point_type = 'RED' AND NOT reversed), 0)::int AS red_total,
        COALESCE(SUM(active_qty) FILTER (WHERE point_type = 'RED'), 0)::int AS red_active,
        COALESCE(SUM(cancelled_qty) FILTER (WHERE point_type = 'RED'), 0)::int AS red_cancelled,
        COALESCE(SUM(quantity) FILTER (WHERE point_type = 'BLACK' AND NOT reversed), 0)::int AS black_total,
        COALESCE(SUM(active_qty) FILTER (WHERE point_type = 'BLACK'), 0)::int AS black_active,
        COALESCE(SUM(cancelled_qty) FILTER (WHERE point_type = 'BLACK'), 0)::int AS black_cancelled,
        COALESCE(SUM(quantity) FILTER (WHERE point_type = 'WHITE' AND NOT reversed), 0)::int AS white_total
      FROM point_state
      WHERE company_id = ${companyId}::uuid AND employee_id = ${employeeId}::uuid
        AND payroll_month = ${monthStart}::date`;

    return {
      month,
      green: { total: s.green_total, available: s.green_available, consumed: s.green_consumed, settled: s.green_settled },
      red: { total: s.red_total, active: s.red_active, cancelled: s.red_cancelled },
      black: { total: s.black_total, active: s.black_active, cancelled: s.black_cancelled },
      white: { total: s.white_total },
    };
  }

  private async scope(companyId: string, userId: string, month?: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, userId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('No employee profile is linked to this account.');

    const value = month ?? (await this.companyPolicy.getCompanyDate(companyId)).toISOString().slice(0, 7);
    return { employeeId: employee.id, month: value, monthStart: `${value}-01` };
  }
}
