import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { LoginThrottleService } from '../auth/guards/login-throttle.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { cairoToday, splitSalaryVersions } from './salary-view';

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
function userParts(user: UserView, today: Date) {
  const role = user.roles[0]?.role;
  const { current, upcoming, history } = splitSalaryVersions(user.employee?.compensationVersions ?? [], today);

  const summary = {
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
    currentSalary: current,
    upcomingSalary: upcoming,
  };
  return { summary, history };
}

/** Create, list and status responses: no salary history. */
function toUserResponse(user: UserView, today: Date) {
  return userParts(user, today).summary;
}

/** `GET /admin/users/{id}`: the summary plus the full salary history, newest first. */
function toUserDetailResponse(user: UserView, today: Date) {
  const { summary, history } = userParts(user, today);
  return { ...summary, salaries: history };
}

@Injectable()
export class UsersService {
  // Every method takes companyId from the authenticated session (never from the request body).
  constructor(
    private readonly prisma: PrismaService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  async createUser(companyId: string, dto: CreateUserDto, creatorId?: string) {
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

      await this.audit.record(tx, {
        companyId,
        actorUserId: creatorId ?? null,
        actorType: 'ADMIN',
        action: 'user.create',
        targetType: 'user',
        targetId: newUser.id,
        changes: {
          email,
          fullName: dto.fullName,
          employeeCode: dto.employeeCode,
          role: role.name,
          initialSalary: dto.initialSalary ?? null,
        },
      });

      return tx.user.findUniqueOrThrow({ where: { id: newUser.id }, select: USER_VIEW_SELECT });
    });

    return toUserResponse(user, cairoToday());
  }

  async getUsers(
    companyId: string,
    page = 1,
    limit = 20,
    search?: string,
    roleCode?: string,
    active?: boolean,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = { companyId };

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

    const today = cairoToday();
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
      data: users.map((u) => toUserResponse(u, today)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(companyId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId },
      select: USER_VIEW_SELECT,
    });

    // 404 (not 403) for another company's record: it must not reveal whether the record exists.
    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    return toUserDetailResponse(user, cairoToday());
  }

  /** Changes the caller's own password, clears the forced-change flag and ends every session. */
  async changeMyPassword(actor: Pick<AuthenticatedUser, 'userId' | 'companyId' | 'role'>, dto: ChangePasswordDto) {
    const userId = actor.userId;
    // A stolen access token must not be able to guess the current password without limit.
    const key = `pwd:${userId}`;
    const wait = this.throttle.retryAfterSeconds(key);
    if (wait > 0) {
      throw new HttpException(`Too many attempts. Please try again in ${wait} seconds.`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const account = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true } });
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    if (!(await argon2.verify(account.passwordHash, dto.currentPassword))) {
      this.throttle.recordFailure(key);
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('The new password must be different from the current one');
    }

    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
      const ended = await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        companyId: actor.companyId,
        actorUserId: userId,
        actorType: actor.role === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE',
        action: 'password.change',
        targetType: 'user',
        targetId: userId,
        changes: { sessionsRevoked: ended.count },
      });
    });
    this.throttle.reset(key);

    return { success: true, message: 'Password changed. Please sign in again.' };
  }

  /** The signed-in user's own profile: selected by session identity only, never by a client-supplied id. */
  async getMyProfile(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: USER_VIEW_SELECT,
    });
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const full = toUserResponse(user, cairoToday());
    return {
      id: full.id,
      email: full.email,
      fullName: full.fullName,
      employeeCode: full.employeeCode,
      phone: full.phone,
      role: full.role?.code ?? null,
      mustChangePassword: full.mustChangePassword,
      activeFrom: full.activeFrom,
    };
  }

  async updateUserStatus(companyId: string, id: string, active: boolean, actorUserId?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId },
      select: { id: true, isActive: true, employee: { select: { id: true } } },
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

      await this.audit.record(tx, {
        companyId,
        actorUserId: actorUserId ?? null,
        actorType: 'ADMIN',
        action: active ? 'user.activate' : 'user.deactivate',
        targetType: 'user',
        targetId: id,
        changes: { isActive: { from: user.isActive, to: active } },
      });

      return tx.user.findUniqueOrThrow({ where: { id }, select: USER_VIEW_SELECT });
    });

    return toUserResponse(updated, cairoToday());
  }

  async createSalary(companyId: string, userId: string, dto: CreateSalaryDto, creatorId?: string) {
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

    const salary = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.employeeSalaryVersion.upsert({
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

      await this.audit.record(tx, {
        companyId,
        actorUserId: creatorId ?? null,
        actorType: 'ADMIN',
        action: 'salary.set',
        targetType: 'user',
        targetId: userId,
        changes: { amount: dto.amount, currency: 'EGP', effectiveFrom: normalizedDate.toISOString().slice(0, 10) },
      });
      return saved;
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
