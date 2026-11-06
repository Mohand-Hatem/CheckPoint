import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { WorkOffer, WorkOfferStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateWorkOfferDto } from "./dto/create-work-offer.dto";

@Injectable()
export class WorkOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(companyId: string, userId: string, dto: CreateWorkOfferDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt <= startsAt
    ) {
      throw new BadRequestException("The offer end must be after its start.");
    }
    const description = dto.description.trim();
    if (!description) {
      throw new BadRequestException("The offer description is required.");
    }

    const employeeIds = dto.employeeIds ?? [];
    if (
      (dto.allEmployees && employeeIds.length > 0) ||
      (!dto.allEmployees && employeeIds.length === 0) ||
      new Set(employeeIds).size !== employeeIds.length
    ) {
      throw new BadRequestException(
        "Select one or more employees, or set allEmployees without employeeIds.",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (employeeIds.length > 0) {
        const employees = await tx.employee.findMany({
          where: {
            companyId,
            id: { in: employeeIds },
            isActive: true,
          },
          select: { id: true },
        });
        if (employees.length !== employeeIds.length) {
          throw new NotFoundException(
            "One or more selected employees are not active in this company.",
          );
        }
      }

      const offer = await tx.workOffer.create({
        data: {
          companyId,
          employeeId: employeeIds.length === 1 ? employeeIds[0] : null,
          allEmployees: dto.allEmployees,
          offerType: dto.offerType,
          startsAt,
          endsAt,
          description,
          createdByUserId: userId,
          ...(employeeIds.length > 1 && {
            recipients: {
              create: employeeIds.map((employeeId) => ({
                companyId,
                employeeId,
              })),
            },
          }),
        },
        include: { recipients: true },
      });

      await this.audit.record(tx, {
        companyId,
        actorUserId: userId,
        actorType: "ADMIN",
        action: "work_offer.create",
        targetType: "work_offer",
        targetId: offer.id,
        changes: {
          offerType: dto.offerType,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          description,
          allEmployees: dto.allEmployees,
          employeeIds,
        },
      });

      return this.toResponse(offer, new Date());
    });
  }

  async listForCompany(companyId: string) {
    const offers = await this.prisma.workOffer.findMany({
      where: { companyId },
      include: { recipients: true },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    });
    const now = new Date();
    return offers.map((offer) => this.toResponse(offer, now));
  }

  async findOne(companyId: string, offerId: string) {
    const offer = await this.prisma.workOffer.findFirst({
      where: { id: offerId, companyId },
      include: { recipients: true },
    });
    if (!offer) {
      throw new NotFoundException("Work offer not found.");
    }
    return this.toResponse(offer, new Date());
  }

  async listForEmployee(companyId: string, userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, userId, isActive: true },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException("Active employee profile not found.");
    }

    const offers = await this.prisma.workOffer.findMany({
      where: {
        companyId,
        OR: [
          { allEmployees: true },
          { employeeId: employee.id },
          { recipients: { some: { employeeId: employee.id } } },
        ],
      },
      include: { recipients: true },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    });
    const now = new Date();
    return offers.map((offer) => this.toResponse(offer, now));
  }

  async cancel(companyId: string, userId: string, offerId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.workOffer.findFirst({
        where: { id: offerId, companyId },
      });
      if (!existing) {
        throw new NotFoundException("Work offer not found.");
      }
      if (
        existing.status !== WorkOfferStatus.ACTIVE ||
        existing.startsAt <= now
      ) {
        throw new ConflictException(
          "A work offer can only be cancelled before its interval begins.",
        );
      }

      const updated = await tx.workOffer.updateMany({
        where: {
          id: offerId,
          companyId,
          status: WorkOfferStatus.ACTIVE,
          startsAt: { gt: now },
        },
        data: {
          status: WorkOfferStatus.CANCELLED,
          cancelledByUserId: userId,
          cancelledAt: now,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          "A work offer can only be cancelled once and before it begins.",
        );
      }

      const offer = await tx.workOffer.findFirst({
        where: { id: offerId, companyId },
        include: { recipients: true },
      });
      if (!offer) {
        throw new NotFoundException("Work offer not found.");
      }

      await this.audit.record(tx, {
        companyId,
        actorUserId: userId,
        actorType: "ADMIN",
        action: "work_offer.cancel",
        targetType: "work_offer",
        targetId: offerId,
        changes: {
          status: WorkOfferStatus.CANCELLED,
          cancelledAt: now.toISOString(),
        },
      });

      return this.toResponse(offer, now);
    });
  }

  private toResponse(
    offer: Pick<
      WorkOffer,
      | "id"
      | "employeeId"
      | "allEmployees"
      | "offerType"
      | "startsAt"
      | "endsAt"
      | "status"
      | "description"
      | "createdByUserId"
      | "createdAt"
      | "cancelledByUserId"
      | "cancelledAt"
    > & {
      recipients?: { employeeId: string }[];
    },
    now: Date,
  ) {
    const employeeIds = new Set(
      offer.recipients?.map((recipient) => recipient.employeeId) ?? [],
    );
    if (offer.employeeId) {
      employeeIds.add(offer.employeeId);
    }

    return {
      id: offer.id,
      offerType: offer.offerType,
      startsAt: offer.startsAt,
      endsAt: offer.endsAt,
      status:
        offer.status === WorkOfferStatus.CANCELLED
          ? WorkOfferStatus.CANCELLED
          : offer.status === WorkOfferStatus.COMPLETED || offer.endsAt <= now
            ? WorkOfferStatus.COMPLETED
            : WorkOfferStatus.ACTIVE,
      description: offer.description,
      allEmployees: offer.allEmployees,
      employeeIds: [...employeeIds],
      createdByUserId: offer.createdByUserId,
      createdAt: offer.createdAt,
      cancelledByUserId: offer.cancelledByUserId,
      cancelledAt: offer.cancelledAt,
    };
  }
}
