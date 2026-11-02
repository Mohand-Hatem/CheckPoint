import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { Prisma, CompanyInvitationStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { CompanyPolicyService } from '../company/company-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListEmployeesQuery } from './dto/list-employees.query';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const INVITATION_EXPIRY_DAYS = 7;
const INVALID_INVITATION = 'This invitation is invalid or has expired';

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function newInvitationToken(now: Date) {
  const rawToken = randomBytes(32).toString('hex');
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(
      now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ),
  };
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyPolicy: CompanyPolicyService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
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

    const { rawToken, tokenHash, expiresAt } = newInvitationToken(now);

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

        await this.audit(tx, companyId, adminUserId, 'employee.invite', 'EMPLOYEE', employee.id, {
          employeeNumber,
          email,
          invitationId: invitation.id,
        });

        return {
          employee,
          invitation,
        };
      });

      return {
        ...result,
        ...(await this.deliverInvitation(email, result.employee.fullName, rawToken)),
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

        if (data.employeeNumber && data.employeeNumber !== before.employeeNumber) {
          // Invitations find their employee by number (no FK), so they follow the rename.
          await tx.companyInvitation.updateMany({
            where: { companyId, employeeNumber: before.employeeNumber },
            data: { employeeNumber: data.employeeNumber },
          });
        }

        await this.audit(tx, companyId, adminUserId, 'employee.update', 'EMPLOYEE', employeeId, {
          before,
          after: data,
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

      await this.audit(
        tx,
        companyId,
        adminUserId,
        isActive ? 'employee.activate' : 'employee.deactivate',
        'EMPLOYEE',
        employeeId,
        { isActive },
      );

      return updated;
    });
  }

  async resendInvitation(companyId: string, adminUserId: string, employeeId: string) {
    const employee = await this.findPendingEmployee(companyId, employeeId);
    const last = await this.prisma.companyInvitation.findFirst({
      where: { companyId, employeeNumber: employee.employeeNumber },
      orderBy: { createdAt: 'desc' },
      select: { email: true },
    });
    if (!last) {
      throw new NotFoundException('No invitation found for this employee');
    }

    const now = new Date();
    const { rawToken, tokenHash, expiresAt } = newInvitationToken(now);

    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.companyInvitation.updateMany({
        where: {
          companyId,
          employeeNumber: employee.employeeNumber,
          status: CompanyInvitationStatus.PENDING,
        },
        data: { status: CompanyInvitationStatus.REVOKED, revokedAt: now },
      });

      const created = await tx.companyInvitation.create({
        data: {
          companyId,
          invitedByUserId: adminUserId,
          email: last.email,
          fullName: employee.fullName,
          employeeNumber: employee.employeeNumber,
          tokenHash,
          expiresAt,
        },
        select: { id: true, status: true, expiresAt: true },
      });

      await this.audit(tx, companyId, adminUserId, 'invitation.resend', 'COMPANY_INVITATION', created.id, {
        employeeId,
      });

      return created;
    });

    return {
      invitation,
      ...(await this.deliverInvitation(last.email, employee.fullName, rawToken)),
    };
  }

  async revokeInvitation(companyId: string, adminUserId: string, employeeId: string) {
    const employee = await this.findPendingEmployee(companyId, employeeId);

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.companyInvitation.updateMany({
        where: {
          companyId,
          employeeNumber: employee.employeeNumber,
          status: CompanyInvitationStatus.PENDING,
        },
        data: { status: CompanyInvitationStatus.REVOKED, revokedAt: new Date() },
      });
      if (count === 0) {
        throw new NotFoundException('No pending invitation for this employee');
      }

      await this.audit(tx, companyId, adminUserId, 'invitation.revoke', 'EMPLOYEE', employeeId, {});

      return { revoked: true };
    });
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const now = new Date();
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invitation = await tx.companyInvitation.findUnique({
          where: { tokenHash: hashToken(dto.token) },
        });
        if (!invitation) {
          throw new BadRequestException(INVALID_INVITATION);
        }
        // Conditional claim: two concurrent accepts cannot both succeed (single use).
        const { count } = await tx.companyInvitation.updateMany({
          where: {
            id: invitation.id,
            status: CompanyInvitationStatus.PENDING,
            expiresAt: { gt: now },
          },
          data: { status: CompanyInvitationStatus.ACCEPTED, acceptedAt: now },
        });
        if (count !== 1) {
          throw new BadRequestException(INVALID_INVITATION);
        }

        const employee = await tx.employee.findUnique({
          where: {
            companyId_employeeNumber: {
              companyId: invitation.companyId,
              employeeNumber: invitation.employeeNumber,
            },
          },
          select: { id: true, userId: true },
        });
        if (!employee || employee.userId) {
          throw new BadRequestException(INVALID_INVITATION);
        }

        const role = await tx.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
        const user = await tx.user.create({
          data: { companyId: invitation.companyId, email: invitation.email, passwordHash },
        });
        await tx.userRole.create({
          data: { userId: user.id, roleId: role.id, assignedByUserId: invitation.invitedByUserId },
        });

        const activeFrom = await this.companyPolicy.getCompanyDate(invitation.companyId, now);
        await tx.employee.update({
          where: { id: employee.id },
          data: { userId: user.id, isActive: true, activeFrom, deactivatedAt: null },
        });

        await this.audit(
          tx,
          invitation.companyId,
          user.id,
          'invitation.accept',
          'COMPANY_INVITATION',
          invitation.id,
          { employeeId: employee.id },
          'EMPLOYEE',
        );

        return { email: user.email };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  private async findPendingEmployee(companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, userId: true, employeeNumber: true, fullName: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    if (employee.userId) {
      throw new ConflictException('This employee has already accepted the invitation');
    }
    return employee;
  }

  private audit(
    tx: Prisma.TransactionClient,
    companyId: string,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    changes: Prisma.InputJsonObject,
    actorType = 'ADMIN',
  ) {
    return tx.auditEvent.create({
      data: { companyId, actorUserId, actorType, action, targetType, targetId, changes },
    });
  }

  // Best-effort and after commit (AC-REQ-032-05): the Admin always gets the link back.
  private async deliverInvitation(email: string, fullName: string, rawToken: string) {
    const base = this.config.get<string>(
      'INVITE_URL_BASE',
      'http://localhost:3000/invitations/accept',
    );
    const invitationLink = `${base}?token=${rawToken}`;
    const smtpConfigured = Boolean(this.config.get<string>('SMTP_HOST'));

    const sent = await this.mailer
      .sendMail({
        to: email,
        subject: 'You are invited to CheckPoint',
        text:
          `Hello ${fullName},\n\n` +
          'You have been invited to join CheckPoint. Set your password here ' +
          `(the link expires in ${INVITATION_EXPIRY_DAYS} days):\n\n${invitationLink}\n`,
      })
      .then(
        () => true,
        (error: unknown) => {
          this.logger.warn(`Invitation email failed: ${String(error)}`);
          return false;
        },
      );

    // Without SMTP the mail only reaches LogTransport, so it was not delivered.
    return { invitationLink, emailSent: smtpConfigured && sent };
  }
}
