import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { CreateUserDto } from './dto/create-user.dto';

const USER_VIEW_SELECT = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  email: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
  roles: { select: { role: { select: { name: true, description: true } } } },
  employee: {
    select: {
      fullName: true,
      employeeNumber: true,
      phone: true,
      activeFrom: true,
      deactivatedAt: true,
      compensationVersions: {
        orderBy: { effectiveFrom: 'desc' },
        select: {
          id: true,
          salary: true,
          effectiveFrom: true,
          createdAt: true,
          createdBy: { select: { id: true, email: true } },
        },
      },
    },
  },
});

type UserView = Prisma.UserGetPayload<{ select: typeof USER_VIEW_SELECT }>;

// Keeps the Step 1.4 response shape while storage follows the users/employees schema.
function toUserResponse(user: UserView) {
  const role = user.roles[0]?.role;
  const salaries = (user.employee?.compensationVersions ?? []).map((s) => ({
    id: s.id,
    amount: s.salary,
    currency: 'EGP',
    effectiveFrom: s.effectiveFrom,
    createdAt: s.createdAt,
    creator: s.createdBy,
  }));

  return {
    id: user.id,
    email: user.email,
    fullName: user.employee?.fullName ?? null,
    employeeCode: user.employee?.employeeNumber ?? null,
    phone: user.employee?.phone ?? null,
    active: user.isActive,
    mustChangePassword: user.mustChangePassword,
    activeFrom: user.employee?.activeFrom ?? null,
    disabledAt: user.employee?.deactivatedAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    role: role ? { code: role.name, name: role.description } : null,
    currentSalary: salaries[0] ?? null,
    salaries,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  async createUser(dto: CreateUserDto, creatorId?: string) {
    const companyId = await this.companyContext.getCompanyId();
    const email = dto.email.toLowerCase();

    const existingEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      throw new ConflictException('Email is already registered');
    }

    const existingCode = await this.prisma.employee.findUnique({
      where: { companyId_employeeNumber: { companyId, employeeNumber: dto.employeeCode } },
    });
    if (existingCode) {
      throw new ConflictException('Employee code is already in use');
    }

    const role = await this.prisma.role.findUnique({
      where: { name: dto.roleCode.toUpperCase() },
    });
    if (!role) {
      throw new NotFoundException(`Role '${dto.roleCode}' not found`);
    }

    // shortcut: every new employee starts on the company's first active shift; per-employee assignment comes with Phase 2 (TASK-006).
    const shift = await this.prisma.shift.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!shift) {
      throw new BadRequestException('No active shift is configured. Run the database seed.');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const now = new Date();
    const effectiveFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { companyId, email, passwordHash, isActive: true, mustChangePassword: true },
      });

      await tx.userRole.create({
        data: { userId: newUser.id, roleId: role.id, assignedByUserId: creatorId || null },
      });

      const employee = await tx.employee.create({
        data: {
          companyId,
          userId: newUser.id,
          employeeNumber: dto.employeeCode,
          fullName: dto.fullName,
          phone: dto.phone || null,
          currentShiftId: shift.id,
        },
      });

      if (dto.initialSalary) {
        await tx.employeeSalaryVersion.create({
          data: {
            companyId,
            employeeId: employee.id,
            salary: dto.initialSalary,
            effectiveFrom,
            createdByUserId: creatorId || null,
          },
        });
      }

      return tx.user.findUniqueOrThrow({ where: { id: newUser.id }, select: USER_VIEW_SELECT });
    });

    return toUserResponse(user);
  }

  async getUsers(
    page = 1,
    limit = 20,
    search?: string,
    roleCode?: string,
    active?: boolean,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = { companyId: await this.companyContext.getCompanyId() };

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { employee: { is: { fullName: { contains: search, mode: 'insensitive' } } } },
        { employee: { is: { employeeNumber: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    if (roleCode) {
      where.roles = { some: { role: { name: roleCode.toUpperCase() } } };
    }

    if (typeof active === 'boolean') {
      where.isActive = active;
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: USER_VIEW_SELECT,
      }),
    ]);

    return {
      data: users.map(toUserResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId: await this.companyContext.getCompanyId() },
      select: USER_VIEW_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    return toUserResponse(user);
  }

  async updateUserStatus(id: string, active: boolean) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId: await this.companyContext.getCompanyId() },
      select: { id: true, employee: { select: { id: true } } },
    });
    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (!active) {
        // Deactivating: revoke all active refresh tokens for immediate session termination
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await tx.user.update({ where: { id }, data: { isActive: active } });

      if (user.employee) {
        // Reactivation restarts the absence window (employees.active_from); deactivation stops new BLACKs.
        await tx.employee.update({
          where: { id: user.employee.id },
          data: active ? { deactivatedAt: null, activeFrom: new Date() } : { deactivatedAt: new Date() },
        });
      }

      return tx.user.findUniqueOrThrow({ where: { id }, select: USER_VIEW_SELECT });
    });

    return toUserResponse(updated);
  }

  async createSalary(userId: string, dto: CreateSalaryDto, creatorId?: string) {
    const companyId = await this.companyContext.getCompanyId();
    const employee = await this.prisma.employee.findFirst({
      where: { userId, companyId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee for user '${userId}' not found`);
    }

    const date = new Date(dto.effectiveFrom);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid effectiveFrom date');
    }

    // Verify date is the 1st of the month
    if (date.getUTCDate() !== 1) {
      throw new BadRequestException(
        'Salary effectiveFrom must be the 1st of the month (e.g. YYYY-MM-01)',
      );
    }

    const normalizedDate = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    );

    const salary = await this.prisma.employeeSalaryVersion.upsert({
      where: {
        employeeId_effectiveFrom: {
          employeeId: employee.id,
          effectiveFrom: normalizedDate,
        },
      },
      update: {
        salary: dto.amount,
        createdByUserId: creatorId || null,
      },
      create: {
        companyId,
        employeeId: employee.id,
        salary: dto.amount,
        effectiveFrom: normalizedDate,
        createdByUserId: creatorId || null,
      },
    });

    return {
      id: salary.id,
      amount: salary.salary,
      currency: 'EGP',
      effectiveFrom: salary.effectiveFrom,
      createdAt: salary.createdAt,
    };
  }
}
