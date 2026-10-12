import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(dto: CreateUserDto, creatorId?: string) {
    const existingEmail = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existingEmail) {
      throw new ConflictException('Email is already registered');
    }

    if (dto.employeeCode) {
      const existingCode = await this.prisma.user.findUnique({
        where: { employeeCode: dto.employeeCode },
      });
      if (existingCode) {
        throw new ConflictException('Employee code is already in use');
      }
    }

    const role = await this.prisma.role.findUnique({
      where: { code: dto.roleCode.toUpperCase() },
    });
    if (!role) {
      throw new NotFoundException(`Role '${dto.roleCode}' not found`);
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const now = new Date();
    const effectiveFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          fullName: dto.fullName,
          employeeCode: dto.employeeCode || null,
          phone: dto.phone || null,
          passwordHash,
          roleId: role.id,
          active: true,
          mustChangePassword: true,
        },
        include: {
          role: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      });

      if (dto.initialSalary) {
        await tx.employeeSalary.create({
          data: {
            userId: newUser.id,
            amount: dto.initialSalary,
            currency: dto.currency || 'EGP',
            effectiveFrom,
            createdBy: creatorId || null,
          },
        });
      }

      return newUser;
    });

    // Exclude passwordHash from output
    const { passwordHash: _, ...result } = user;
    return result;
  }

  async getUsers(
    page = 1,
    limit = 20,
    search?: string,
    roleCode?: string,
    active?: boolean,
  ) {
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (roleCode) {
      where.role = { code: roleCode.toUpperCase() };
    }

    if (typeof active === 'boolean') {
      where.active = active;
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          employeeCode: true,
          phone: true,
          active: true,
          activeFrom: true,
          disabledAt: true,
          createdAt: true,
          role: {
            select: {
              code: true,
              name: true,
            },
          },
          salaries: {
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
            select: {
              amount: true,
              currency: true,
              effectiveFrom: true,
            },
          },
        },
      }),
    ]);

    return {
      data: users.map((u) => ({
        ...u,
        currentSalary: u.salaries[0] || null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        employeeCode: true,
        phone: true,
        active: true,
        activeFrom: true,
        disabledAt: true,
        createdAt: true,
        updatedAt: true,
        role: {
          select: {
            code: true,
            name: true,
          },
        },
        salaries: {
          orderBy: { effectiveFrom: 'desc' },
          select: {
            id: true,
            amount: true,
            currency: true,
            effectiveFrom: true,
            createdAt: true,
            creator: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    return user;
  }

  async updateUserStatus(id: string, active: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    if (!active) {
      // Deactivating: revoke all active refresh tokens for immediate session termination
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        active,
        disabledAt: active ? null : new Date(),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        active: true,
        disabledAt: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async createSalary(userId: string, dto: CreateSalaryDto, creatorId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID '${userId}' not found`);
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

    const salary = await this.prisma.employeeSalary.upsert({
      where: {
        userId_effectiveFrom: {
          userId,
          effectiveFrom: normalizedDate,
        },
      },
      update: {
        amount: dto.amount,
        currency: dto.currency || 'EGP',
        createdBy: creatorId || null,
      },
      create: {
        userId,
        amount: dto.amount,
        currency: dto.currency || 'EGP',
        effectiveFrom: normalizedDate,
        createdBy: creatorId || null,
      },
    });

    return salary;
  }
}
