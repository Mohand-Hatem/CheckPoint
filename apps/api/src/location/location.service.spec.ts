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

  it("creates a location with a random QR secret that is never returned", async () => {
    const db = createDb();
    db.location.create = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ id: locationId, active: true, ...data }));

    const result = await createService(db).createLocation(userId, {
      name: "Main Office",
      latitude: 30.0444,
      longitude: 31.2357,
      radiusMeters: 50,
    });

    const { qrSecret } = db.location.create.mock.calls[0][0].data;
    expect(Buffer.isBuffer(qrSecret) && qrSecret.length).toBe(32);
    expect(result).not.toHaveProperty("qrSecret");
    expect(result).toEqual({
      id: locationId,
      name: "Main Office",
      latitude: 30.0444,
      longitude: 31.2357,
      radiusMeters: 50,
      active: true,
    });
  });

  it("creates with a trimmed name and the 50 m default radius, and rejects a blank name", async () => {
    const db = createDb();
    db.location.create = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ id: locationId, active: true, ...data }));
    const service = createService(db);

    await service.createLocation(userId, { name: "  Branch  ", latitude: 30.1, longitude: 31.2 });
    expect(db.location.create.mock.calls[0][0].data).toMatchObject({ name: "Branch", radiusM: 50 });

    await expect(
      service.createLocation(userId, { name: "  ", latitude: 30.1, longitude: 31.2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("lists only the company's locations, by name, without QR secrets", async () => {
    const db = createDb();
    db.location.findMany = jest.fn().mockResolvedValue([
      { id: locationId, name: "Main Office", latitude: 30.0444, longitude: 31.2357, radiusM: 50, active: true },
    ]);

    await expect(createService(db).listLocations(companyId)).resolves.toEqual([
      { id: locationId, name: "Main Office", latitude: 30.0444, longitude: 31.2357, radiusMeters: 50, active: true },
    ]);
    expect(db.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId }, orderBy: { name: "asc" } }),
    );
    expect(db.location.findMany.mock.calls[0][0].select.qrSecret).toBeUndefined();
  });

  it("returns 404 for one location outside the company", async () => {
    await expect(createService(createDb(null)).getLocation(companyId, locationId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe("employee location assignments (FR-LOC-1)", () => {
    const targetUserId = "c0ffee00-0000-4000-8000-000000000009";
    const employeeId = "c0ffee00-0000-4000-8000-00000000000e";
    const otherLocationId = "c0ffee00-0000-4000-8000-000000000004";
    const row = (id: string, name: string) => ({ id, name, latitude: 30, longitude: 31, radiusM: 50, active: true });

    function assignDb(found: Record<string, unknown>[]) {
      const db = createDb();
      db.employee = { findFirst: jest.fn().mockResolvedValue({ id: employeeId }) };
      db.employeeLocation = {
        findMany: jest.fn().mockResolvedValue([{ locationId: otherLocationId }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: found.length }),
      };
      db.location.findMany = jest.fn().mockResolvedValue(found);
      return db;
    }

    it("replaces the employee's locations in one audited transaction", async () => {
      const db = assignDb([row(locationId, "Main Office")]);

      await expect(
        createService(db).setUserLocations(companyId, userId, targetUserId, [locationId]),
      ).resolves.toEqual([
        { id: locationId, name: "Main Office", latitude: 30, longitude: 31, radiusMeters: 50, active: true },
      ]);

      expect(db.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: targetUserId, companyId } }),
      );
      expect(db.location.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [locationId] }, companyId, active: true } }),
      );
      expect(db.employeeLocation.deleteMany).toHaveBeenCalledWith({ where: { companyId, employeeId } });
      expect(db.employeeLocation.createMany).toHaveBeenCalledWith({
        data: [{ companyId, employeeId, locationId }],
      });
      expect(db.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId,
          actorUserId: userId,
          action: "user.locations_set",
          targetType: "user",
          targetId: targetUserId,
          changes: { before: [otherLocationId], after: [locationId] },
        }),
      });
    });

    it("clears every assignment with an empty list", async () => {
      const db = assignDb([]);
      await expect(createService(db).setUserLocations(companyId, userId, targetUserId, [])).resolves.toEqual([]);
      expect(db.employeeLocation.deleteMany).toHaveBeenCalled();
      expect(db.employeeLocation.createMany).not.toHaveBeenCalled();
    });

    it("rejects a location that is unknown, inactive or in another company, changing nothing", async () => {
      const db = assignDb([row(locationId, "Main Office")]);

      await expect(
        createService(db).setUserLocations(companyId, userId, targetUserId, [locationId, otherLocationId]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.employeeLocation.deleteMany).not.toHaveBeenCalled();
    });

    it("answers 404 when the user is not an employee of the company", async () => {
      const db = assignDb([]);
      db.employee.findFirst.mockResolvedValue(null);

      await expect(
        createService(db).setUserLocations(companyId, userId, targetUserId, []),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(createService(db).listUserLocations(companyId, targetUserId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("lists the employee's current locations", async () => {
      const db = assignDb([]);
      db.employeeLocation.findMany.mockResolvedValue([{ location: row(locationId, "Main Office") }]);

      await expect(createService(db).listUserLocations(companyId, targetUserId)).resolves.toEqual([
        { id: locationId, name: "Main Office", latitude: 30, longitude: 31, radiusMeters: 50, active: true },
      ]);
    });
  });

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
