import "reflect-metadata";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { LocationService } from "./location.service";

describe("LocationService update/delete", () => {
  const userId = "c0ffee00-0000-4000-8000-000000000001";
  const companyId = "c0ffee00-0000-4000-8000-000000000002";
  const locationId = "c0ffee00-0000-4000-8000-000000000003";

  function createService(db: Record<string, any>) {
    db.$transaction = jest.fn(async (operation: (tx: unknown) => unknown) =>
      operation(db),
    );
    db.auditEvent = { create: jest.fn().mockResolvedValue({}) };

    return new LocationService(
      db as unknown as PrismaService,
      new AuditService(db as unknown as PrismaService),
    );
  }

  function createDb(
    location: Record<string, unknown> | null = {
      id: locationId,
      name: "Main Office",
      latitude: 30.0444,
      longitude: 31.2357,
      radiusM: 50,
      active: true,
    },
  ) {
    return {
      user: {
        findFirst: jest.fn().mockResolvedValue({ companyId }),
      },
      location: {
        findFirst: jest.fn().mockResolvedValue(location),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...location, ...data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as Record<string, any>;
  }

  it("updates supplied fields within the Admin's company and audits before/after", async () => {
    const db = createDb();

    await expect(
      createService(db).updateLocation(userId, locationId, {
        name: "  Updated Office ",
        radiusMeters: 80,
      }),
    ).resolves.toEqual({
      id: locationId,
      name: "Updated Office",
      latitude: 30.0444,
      longitude: 31.2357,
      radiusMeters: 80,
      active: true,
    });

    expect(db.user.findFirst.mock.calls[0][0].where).toMatchObject({
      id: userId,
      roles: { some: { role: { name: "ADMIN", isSystem: true } } },
    });
    expect(db.location.findFirst.mock.calls[0][0].where).toEqual({
      id: locationId,
      companyId,
    });
    expect(db.location.update.mock.calls[0][0].data).toEqual({
      name: "Updated Office",
      radiusM: 80,
    });
    expect(db.auditEvent.create.mock.calls[0][0].data).toMatchObject({
      companyId,
      actorUserId: userId,
      actorType: "ADMIN",
      action: "UPDATE_LOCATION",
      targetId: locationId,
    });
  });

  it("validates the resulting coordinate pair when only one coordinate changes", async () => {
    const db = createDb({
      id: locationId,
      name: "Main Office",
      latitude: 30,
      longitude: 31,
      radiusM: 50,
      active: true,
    });

    await expect(
      createService(db).updateLocation(userId, locationId, {
        latitude: 91,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.location.update).not.toHaveBeenCalled();
  });

  it("rejects an empty update", async () => {
    const db = createDb();

    await expect(
      createService(db).updateLocation(userId, locationId, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.location.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 for a location outside the Admin's company", async () => {
    const db = createDb(null);

    await expect(
      createService(db).updateLocation(userId, locationId, { name: "New" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.location.update).not.toHaveBeenCalled();
  });

  it("soft-deletes a location and preserves its employee assignments", async () => {
    const db = createDb();

    await expect(
      createService(db).deleteLocation(userId, locationId),
    ).resolves.toMatchObject({ id: locationId, active: false });

    expect(db.location.updateMany).toHaveBeenCalledWith({
      where: { id: locationId, companyId, active: true },
      data: { active: false },
    });
    expect(db.location.delete).toBeUndefined();
    expect(db.auditEvent.create.mock.calls[0][0].data).toMatchObject({
      companyId,
      actorUserId: userId,
      action: "DELETE_LOCATION",
      targetId: locationId,
      changes: { softDeleted: true },
    });
  });

  it("refuses to delete an already inactive location", async () => {
    const db = createDb({
      id: locationId,
      name: "Main Office",
      latitude: 30.0444,
      longitude: 31.2357,
      radiusM: 50,
      active: false,
    });

    await expect(
      createService(db).deleteLocation(userId, locationId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.location.updateMany).not.toHaveBeenCalled();
  });
});
