import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, CompanyInvitationStatus } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { CompanyPolicyService } from '../company/company-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListEmployeesQuery } from './dto/list-employees.query';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const INVITATION_EXPIRY_DAYS = 7;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyPolicy: CompanyPolicyService,
  ) {}

  async create(
    companyId: string,
    adminUserId: string,
    dto: CreateEmployeeDto,
  ) {
    const email = dto.email.toLowerCase().trim();
    const employeeNumber = dto.employeeNumber.trim();

    const admin = await this.prisma.user.findFirst({
      where: {
        id: adminUserId,
        companyId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!admin) {
      throw new NotFoundException('Admin account not found');
    }

    const shift = await this.prisma.shift.findFirst({
      where: {
        id: dto.shiftId,
        companyId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!shift) {
      throw new BadRequestException(
        'The selected shift is not available in this company',
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException(
        'An account with this email already exists',
      );
    }

    const existingEmployee = await this.prisma.employee.findFirst({
      where: {
        companyId,
        employeeNumber,
      },
      select: { id: true },
    });

    if (existingEmployee) {
      throw new ConflictException(
        'An employee with this number already exists',
      );
    }

    const now = new Date();

    await this.prisma.companyInvitation.updateMany({
      where: {
        email,
        status: CompanyInvitationStatus.PENDING,
        expiresAt: { lte: now },
      },
      data: {
        status: CompanyInvitationStatus.EXPIRED,
      },
    });

    const pendingInvitation =
      await this.prisma.companyInvitation.findFirst({
        where: {
          email,
          status: CompanyInvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
        select: { id: true },
      });

    if (pendingInvitation) {
      throw new ConflictException(
        'A pending invitation already exists for this email',
      );
    }

    const rawToken = randomBytes(32).toString('hex');

    const tokenHash = createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const expiresAt = new Date(
      now.getTime() +
        INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    const effectiveFrom = await this.companyPolicy.getCompanyDate(
      companyId,
      now,
    );

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: {
            companyId,
            currentShiftId: shift.id,
            employeeNumber,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            isActive: false,
          },
        });

        await tx.shiftAssignment.create({
          data: {
            companyId,
            employeeId: employee.id,
            shiftId: shift.id,
            effectiveFrom,
            assignedByUserId: adminUserId,
          },
        });

        const invitation = await tx.companyInvitation.create({
          data: {
            companyId,
            invitedByUserId: adminUserId,
            email,
            fullName: employee.fullName,
            employeeNumber,
            tokenHash,
            expiresAt,
          },
          select: {
            id: true,
            status: true,
            expiresAt: true,
          },
        });

        return {
          employee,
          invitation,
        };
      });

      return {
        ...result,
        invitationToken: rawToken,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'The employee number or email is already in use',
        );
      }

      throw error;
    }
  }

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
  async setActive(
    companyId: string,
    employeeId: string,
    isActive: boolean,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        companyId,
      },
      select: {
        id: true,
        userId: true,
        isActive: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedEmployee = await tx.employee.update({
        where: {
          id: employeeId,
        },
        data: {
          isActive,
          deactivatedAt: isActive ? null : new Date(),
        },
      });

      if (employee.userId) {
        await tx.user.update({
          where: {
            id: employee.userId,
          },
          data: {
            isActive,
          },
        });
      }

      return updatedEmployee;
    });
  }
}
