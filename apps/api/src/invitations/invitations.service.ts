import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CompanyInvitationStatus, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto, CreateInvitationDto } from './dto/invitation.dto';

const INVITATION_TTL_DAYS = 7; // proposal in spec v0.4.0, unconfirmed
const INVALID = 'Invitation is invalid or has expired';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Never returns tokenHash.
const VIEW = {
  id: true,
  email: true,
  fullName: true,
  employeeNumber: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.CompanyInvitationSelect;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(companyId: string, invitedByUserId: string, dto: CreateInvitationDto) {
    const email = dto.email.toLowerCase();
    const employeeNumber = dto.employeeCode.trim();
    const now = new Date();

    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('An account with this email already exists');
    }
    if (
      await this.prisma.employee.findUnique({
        where: { companyId_employeeNumber: { companyId, employeeNumber } },
      })
    ) {
      throw new ConflictException('Employee code is already in use');
    }

    await this.prisma.companyInvitation.updateMany({
      where: { companyId, status: CompanyInvitationStatus.PENDING, expiresAt: { lt: now } },
      data: { status: CompanyInvitationStatus.EXPIRED },
    });

    // Friendly early answer; the partial unique indexes (migration 20261025000100) are the real guarantee.
    const pending = await this.prisma.companyInvitation.findFirst({
      where: {
        companyId,
        status: CompanyInvitationStatus.PENDING,
        OR: [{ email }, { employeeNumber }],
      },
    });
    if (pending) {
      throw new ConflictException('A pending invitation already exists for this email or employee code');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    let invitation;
    try {
      invitation = await this.prisma.$transaction(async (tx) => {
        const created = await tx.companyInvitation.create({
          data: {
            companyId,
            invitedByUserId,
            email,
            fullName: dto.fullName.trim(),
            employeeNumber,
            tokenHash: hashToken(token),
            expiresAt,
          },
          select: VIEW,
        });
        await this.audit.record(tx, {
          companyId,
          actorUserId: invitedByUserId,
          actorType: 'ADMIN',
          action: 'invitation.create',
          targetType: 'invitation',
          targetId: created.id,
          changes: { email, employeeNumber, expiresAt: expiresAt.toISOString() }, // never the token
        });
        return created;
      });
    } catch (error) {
      // A concurrent request created the same pending invitation between our check and this insert.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A pending invitation already exists for this email or employee code');
      }
      throw error;
    }

    // The raw token is returned once and never stored (spec GAP-026 default: the Admin shares the link).
    return { ...invitation, token };
  }

  list(companyId: string) {
    return this.prisma.companyInvitation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: VIEW,
    });
  }

  async revoke(companyId: string, id: string, actorUserId: string) {
    // 404 for another company's invitation, same as any foreign record.
    const invitation = await this.prisma.companyInvitation.findFirst({ where: { id, companyId } });
    if (!invitation) {
      throw new NotFoundException(`Invitation '${id}' not found`);
    }
    if (invitation.status !== CompanyInvitationStatus.PENDING) {
      throw new ConflictException(`Only a pending invitation can be revoked (this one is ${invitation.status})`);
    }

    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.companyInvitation.update({
        where: { id },
        data: { status: CompanyInvitationStatus.REVOKED, revokedAt: new Date() },
        select: VIEW,
      });
      await this.audit.record(tx, {
        companyId,
        actorUserId,
        actorType: 'ADMIN',
        action: 'invitation.revoke',
        targetType: 'invitation',
        targetId: id,
        changes: { email: invitation.email, status: { from: invitation.status, to: 'REVOKED' } },
      });
      return revoked;
    });
  }

  async accept(dto: AcceptInvitationDto) {
    const invitation = await this.prisma.companyInvitation.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    const now = new Date();
    if (!invitation || invitation.status !== CompanyInvitationStatus.PENDING || invitation.expiresAt <= now) {
      throw new BadRequestException(INVALID);
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    try {
      await this.prisma.$transaction(async (tx) => {
        // Claim first: only one concurrent accept can flip PENDING -> ACCEPTED (single use).
        const claimed = await tx.companyInvitation.updateMany({
          where: { id: invitation.id, status: CompanyInvitationStatus.PENDING, expiresAt: { gt: now } },
          data: { status: CompanyInvitationStatus.ACCEPTED, acceptedAt: now },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(INVALID);
        }

        const role = await tx.role.findUnique({ where: { name: 'EMPLOYEE' } });
        const shift = await tx.shift.findFirst({
          where: { companyId: invitation.companyId, isActive: true },
          orderBy: { createdAt: 'asc' },
        });
        if (!role || !shift) {
          throw new BadRequestException('The company is not fully configured (role or shift missing)');
        }

        const user = await tx.user.create({
          data: { companyId: invitation.companyId, email: invitation.email, passwordHash, isActive: true },
        });
        await tx.userRole.create({
          data: { userId: user.id, roleId: role.id, assignedByUserId: invitation.invitedByUserId },
        });
        await tx.employee.create({
          data: {
            companyId: invitation.companyId,
            userId: user.id,
            employeeNumber: invitation.employeeNumber,
            fullName: invitation.fullName,
            currentShiftId: shift.id,
          },
        });
        await this.audit.record(tx, {
          companyId: invitation.companyId,
          actorUserId: user.id,
          actorType: 'EMPLOYEE',
          action: 'invitation.accept',
          targetType: 'invitation',
          targetId: invitation.id,
          changes: { email: invitation.email, employeeNumber: invitation.employeeNumber, userId: user.id },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this email or employee code already exists');
      }
      throw error;
    }

    return { email: invitation.email, message: 'Account created. You can now sign in.' };
  }
}
