import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CompanyPolicyService } from '../company/company-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListEmployeesQuery } from './dto/list-employees.query';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

// Employees are created by InvitationsService (accept) or UsersService (direct create).
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyPolicy: CompanyPolicyService,
    private readonly audit: AuditService,
  ) {}

  async assignShift(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      employeeId: string;
      shiftId: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      assignedByUserId: string | null;
      companyDate: Date;
    },
  ) {
    const employee = await tx.employee.findFirst({
      where: { id: input.employeeId, companyId: input.companyId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const overlapping = await tx.shiftAssignment.findMany({
      where: {
        companyId: input.companyId,
        employeeId: input.employeeId,
        effectiveFrom: {
          lte: input.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z'),
        },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: input.effectiveFrom } },
        ],
      },
      orderBy: { effectiveFrom: 'asc' },
    });
    const priorAssignments = overlapping.filter(
      (assignment) => assignment.effectiveFrom < input.effectiveFrom,
    );
    const laterOrSameAssignments = overlapping.filter(
      (assignment) => assignment.effectiveFrom >= input.effectiveFrom,
    );

    if (priorAssignments.length > 1 || laterOrSameAssignments.length > 0) {
      throw new ConflictException(
        'The employee already has an assignment overlapping these effective dates.',
      );
    }

    if (priorAssignments[0]) {
      await tx.shiftAssignment.update({
        where: { id: priorAssignments[0].id },
        data: {
          effectiveTo: new Date(
            input.effectiveFrom.getTime() - 24 * 60 * 60 * 1000,
          ),
        },
      });
    }

    const assignment = await tx.shiftAssignment.create({
      data: {
        companyId: input.companyId,
        employeeId: input.employeeId,
        shiftId: input.shiftId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        assignedByUserId: input.assignedByUserId,
      },
    });

    if (
      input.effectiveFrom <= input.companyDate &&
      (input.effectiveTo === null || input.effectiveTo >= input.companyDate)
    ) {
      await tx.employee.update({
        where: { id: employee.id },
        data: { currentShiftId: input.shiftId },
      });
    }

    return assignment;
  }

  async assignInitialShift(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      employeeId: string;
      shiftId: string;
      assignedByUserId: string | null;
    },
  ) {
    const effectiveFrom = await this.companyPolicy.getCompanyDate(
      input.companyId,
    );

    return this.assignShift(tx, {
      ...input,
      effectiveFrom,
      effectiveTo: null,
      companyDate: effectiveFrom,
    });
  }

  async findAll(companyId: string, query: ListEmployeesQuery) {
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      ...(query.isActive !== undefined && {
        isActive: query.isActive,
      }),
      ...(query.search?.trim() && {
        OR: [
          {
            fullName: {
              contains: query.search.trim(),
              mode: 'insensitive',
            },
          },
          {
            employeeNumber: {
              contains: query.search.trim(),
              mode: 'insensitive',
            },
          },
          {
            phone: {
              contains: query.search.trim(),
              mode: 'insensitive',
            },
          },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include: {
          user: {
            select: {
              email: true,
              isActive: true,
            },
          },
          currentShift: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        companyId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            isActive: true,
          },
        },
        currentShift: {
          select: {
            id: true,
            name: true,
          },
        },
        shiftAssignments: {
          orderBy: {
            effectiveFrom: 'desc',
          },
          include: {
            shift: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return employee;
  }

  async update(
    companyId: string,
    adminUserId: string,
    employeeId: string,
    dto: UpdateEmployeeDto,
  ) {
    const before = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, employeeNumber: true, fullName: true, phone: true },
    });
    if (!before) {
      throw new NotFoundException('Employee not found');
    }

    const data = {
      employeeNumber: dto.employeeNumber?.trim(),
      fullName: dto.fullName?.trim(),
      phone: dto.phone === undefined ? undefined : dto.phone.trim() || null,
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employee.update({
          where: { id: employeeId },
          data,
        });

        await this.audit.record(tx, {
          companyId,
          actorUserId: adminUserId,
          actorType: 'ADMIN',
          action: 'employee.update',
          targetType: 'employee',
          targetId: employeeId,
          changes: { before, after: data },
        });

        return employee;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An employee with this number already exists');
      }
      throw error;
    }
  }

  async setActive(
    companyId: string,
    adminUserId: string,
    employeeId: string,
    isActive: boolean,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, userId: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    const { userId } = employee;
    if (!userId) {
      throw new BadRequestException(
        'This employee has not accepted the invitation yet',
      );
    }
    // The caller is an active Admin, so refusing self-deactivation keeps one active Admin (AC-REQ-007-05).
    if (!isActive && userId === adminUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    // Reactivation restarts the absence window; deactivation stops new BLACKs. History is kept.
    const data = isActive
      ? {
          isActive: true,
          deactivatedAt: null,
          activeFrom: await this.companyPolicy.getCompanyDate(companyId),
        }
      : { isActive: false, deactivatedAt: new Date() };

    return this.prisma.$transaction(async (tx) => {
      if (!isActive) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await tx.user.update({ where: { id: userId }, data: { isActive } });

      const updated = await tx.employee.update({ where: { id: employeeId }, data });

      await this.audit.record(tx, {
        companyId,
        actorUserId: adminUserId,
        actorType: 'ADMIN',
        action: isActive ? 'employee.activate' : 'employee.deactivate',
        targetType: 'employee',
        targetId: employeeId,
        changes: { isActive },
      });

      return updated;
    });
  }
}
