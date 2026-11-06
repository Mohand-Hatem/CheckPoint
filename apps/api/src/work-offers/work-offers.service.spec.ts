import "reflect-metadata";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { WorkOfferStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateWorkOfferDto } from "./dto/create-work-offer.dto";
import { WorkOffersService } from "./work-offers.service";

describe("WorkOffersService (TEST-044)", () => {
  const companyId = "c0ffee00-0000-4000-8000-000000000001";
  const adminUserId = "c0ffee00-0000-4000-8000-000000000002";
  const employeeId = "c0ffee00-0000-4000-8000-000000000003";
  const otherEmployeeId = "c0ffee00-0000-4000-8000-000000000004";
  const userId = "c0ffee00-0000-4000-8000-000000000005";
  const startsAt = new Date(Date.now() + 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

  function createService(db: Record<string, any>) {
    db.$transaction = jest.fn(async (operation: (tx: unknown) => unknown) =>
      operation(db),
    );
    db.auditEvent = db.auditEvent ?? {
      create: jest.fn().mockResolvedValue({}),
    };
    return new WorkOffersService(
      db as unknown as PrismaService,
      new AuditService(db as unknown as PrismaService),
    );
  }

  function createDto(
    overrides: Partial<CreateWorkOfferDto> = {},
  ): CreateWorkOfferDto {
    return {
      offerType: "OVERTIME",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      description: "Additional work",
      allEmployees: false,
      employeeIds: [employeeId],
      ...overrides,
    };
  }

  function offer(overrides: Record<string, unknown> = {}) {
    return {
      id: "offer-1",
      companyId,
      employeeId,
      allEmployees: false,
      offerType: "OVERTIME",
      startsAt,
      endsAt,
      status: WorkOfferStatus.ACTIVE,
      description: "Additional work",
      createdByUserId: adminUserId,
      createdAt: new Date(),
      cancelledByUserId: null,
      cancelledAt: null,
      ...overrides,
    };
  }

  it("creates a selected single-employee offer and audits it", async () => {
    const created = offer();
    const db: Record<string, any> = {
      employee: {
        findMany: jest.fn().mockResolvedValue([{ id: employeeId }]),
      },
      workOffer: {
        create: jest.fn().mockResolvedValue({ ...created, recipients: [] }),
      },
    };

    await expect(
      createService(db).create(companyId, adminUserId, createDto()),
    ).resolves.toMatchObject({
      status: "ACTIVE",
      employeeIds: [employeeId],
      allEmployees: false,
    });

    expect(db.workOffer.create.mock.calls[0][0].data).toMatchObject({
      companyId,
      employeeId,
      allEmployees: false,
    });
    expect(db.auditEvent.create.mock.calls[0][0].data).toMatchObject({
      companyId,
      actorUserId: adminUserId,
      action: "work_offer.create",
    });
  });

  it("stores multiple selected employees as recipient rows", async () => {
    const recipients = [
      { companyId, employeeId },
      { companyId, employeeId: otherEmployeeId },
    ];
    const db: Record<string, any> = {
      employee: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: employeeId }, { id: otherEmployeeId }]),
      },
      workOffer: {
        create: jest
          .fn()
          .mockResolvedValue({ ...offer({ employeeId: null }), recipients }),
      },
    };

    const result = await createService(db).create(
      companyId,
      adminUserId,
      createDto({ employeeIds: [employeeId, otherEmployeeId] }),
    );

    expect(db.workOffer.create.mock.calls[0][0].data).toMatchObject({
      employeeId: null,
      recipients: {
        create: [
          { companyId, employeeId },
          { companyId, employeeId: otherEmployeeId },
        ],
      },
    });
    expect(result.employeeIds).toEqual([employeeId, otherEmployeeId]);
  });

  it("creates all-company offers without explicit recipients", async () => {
    const db: Record<string, any> = {
      workOffer: {
        create: jest.fn().mockResolvedValue({
          ...offer({ employeeId: null, allEmployees: true }),
          recipients: [],
        }),
      },
    };

    const result = await createService(db).create(
      companyId,
      adminUserId,
      createDto({ allEmployees: true, employeeIds: undefined }),
    );

    expect(db.workOffer.create.mock.calls[0][0].data).toMatchObject({
      companyId,
      employeeId: null,
      allEmployees: true,
    });
    expect(result.employeeIds).toEqual([]);
    expect(db.employee).toBeUndefined();
  });

  it("rejects all-company offers that also specify selected recipients", async () => {
    const db: Record<string, any> = {
      workOffer: { create: jest.fn() },
    };

    await expect(
      createService(db).create(
        companyId,
        adminUserId,
        createDto({ allEmployees: true }),
      ),
    ).rejects.toThrow("Select one or more employees");
    expect(db.workOffer.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid interval", async () => {
    const db: Record<string, any> = { workOffer: { create: jest.fn() } };
    const dto = createDto({
      startsAt: endsAt.toISOString(),
      endsAt: startsAt.toISOString(),
    });

    await expect(
      createService(db).create(companyId, adminUserId, dto),
    ).rejects.toThrow("The offer end must be after its start.");
    expect(db.workOffer.create).not.toHaveBeenCalled();
  });

  it("rejects an empty description after trimming", async () => {
    const db: Record<string, any> = {
      employee: {
        findMany: jest.fn().mockResolvedValue([{ id: employeeId }]),
      },
      workOffer: { create: jest.fn() },
    };

    await expect(
      createService(db).create(
        companyId,
        adminUserId,
        createDto({ description: "   " }),
      ),
    ).rejects.toThrow("The offer description is required.");
    expect(db.workOffer.create).not.toHaveBeenCalled();
  });

  it("rejects selected employees outside the company or inactive", async () => {
    const db: Record<string, any> = {
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      workOffer: { create: jest.fn() },
    };

    await expect(
      createService(db).create(companyId, adminUserId, createDto()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.employee.findMany.mock.calls[0][0].where).toMatchObject({
      companyId,
      id: { in: [employeeId] },
      isActive: true,
    });
    expect(db.workOffer.create).not.toHaveBeenCalled();
  });

  it("returns all-company offers to employees, including dynamic company-wide targets", async () => {
    const db: Record<string, any> = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: employeeId }),
      },
      workOffer: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await createService(db).listForEmployee(companyId, userId);

    expect(db.workOffer.findMany.mock.calls[0][0].where).toMatchObject({
      companyId,
      OR: [
        { allEmployees: true },
        { employeeId },
        { recipients: { some: { employeeId } } },
      ],
    });
    expect(db.employee.findFirst.mock.calls[0][0].where).toEqual({
      companyId,
      userId,
      isActive: true,
    });
  });

  it("derives COMPLETED from endsAt for offers whose persisted state remains ACTIVE", async () => {
    const db: Record<string, any> = {
      workOffer: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            offer({ endsAt: new Date(Date.now() - 1000), recipients: [] }),
          ]),
      },
    };

    await expect(
      createService(db).listForCompany(companyId),
    ).resolves.toMatchObject([{ status: "COMPLETED" }]);
  });

  it("cancels before startsAt and audits the state change", async () => {
    const db: Record<string, any> = {
      workOffer: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(offer())
          .mockResolvedValueOnce(
            offer({
              status: WorkOfferStatus.CANCELLED,
              cancelledByUserId: adminUserId,
              cancelledAt: new Date(),
              recipients: [],
            }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await expect(
      createService(db).cancel(companyId, adminUserId, "offer-1"),
    ).resolves.toMatchObject({ status: "CANCELLED" });
    expect(db.workOffer.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "offer-1",
      companyId,
      status: WorkOfferStatus.ACTIVE,
    });
    expect(db.auditEvent.create.mock.calls[0][0].data).toMatchObject({
      actorUserId: adminUserId,
      action: "work_offer.cancel",
    });
  });

  it("refuses cancellation once the interval has started", async () => {
    const db: Record<string, any> = {
      workOffer: {
        findFirst: jest
          .fn()
          .mockResolvedValue(offer({ startsAt: new Date(Date.now() - 1000) })),
        updateMany: jest.fn(),
      },
    };

    await expect(
      createService(db).cancel(companyId, adminUserId, "offer-1"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.workOffer.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for an offer outside the Admin company", async () => {
    const db: Record<string, any> = {
      workOffer: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      createService(db).findOne(companyId, "foreign-offer"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.workOffer.findFirst.mock.calls[0][0].where).toEqual({
      id: "foreign-offer",
      companyId,
    });
  });
});
