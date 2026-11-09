import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateLocationDto } from "./dto/update-location-dto";
import { isValidQrToken, parseQrToken, qrSlot, signQrToken } from "./qr-token";

type CreateLocationInput = {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
};

// Public fields only: qrSecret is never selected for a response.
const LOCATION_VIEW = {
  id: true,
  name: true,
  latitude: true,
  longitude: true,
  radiusM: true,
  active: true,
} as const;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private assertValidCoordinates(latitude: number, longitude: number): void {
    const valid =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;

    if (!valid) throw new BadRequestException("Invalid latitude or longitude");
    if (latitude === 0 && longitude === 0) {
      throw new BadRequestException(
        "Coordinates (0, 0) are not a valid location",
      );
    }
  }

  private async getAdminCompanyId(
    db: Prisma.TransactionClient,
    userId: string,
  ): Promise<string> {
    const user = await db.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        company: { isActive: true },
        roles: { some: { role: { name: "ADMIN", isSystem: true } } },
      },
      select: { companyId: true },
    });

    if (!user) throw new ForbiddenException("User is not an admin");
    return user.companyId;
  }

  async listLocations(companyId: string) {
    const locations = await this.prismaService.location.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      select: LOCATION_VIEW,
    });
    return locations.map((location) => this.toResponse(location));
  }

  async getLocation(companyId: string, locationId: string) {
    const location = await this.prismaService.location.findFirst({
      where: { id: locationId, companyId },
      select: LOCATION_VIEW,
    });
    if (!location) throw new NotFoundException("Location not found");
    return this.toResponse(location);
  }

  /** docs/05 §4.5: the kiosk shows this token; it is accepted until the end of the next slot. */
  async getQrToken(companyId: string, locationId: string) {
    const location = await this.prismaService.location.findFirst({
      where: { id: locationId, companyId },
      select: { id: true, active: true, qrSecret: true },
    });
    if (!location) throw new NotFoundException("Location not found");
    if (!location.active) throw new ConflictException("Location is inactive");

    const rotation = await this.qrRotationSeconds(companyId);
    const slot = qrSlot(Date.now(), rotation);
    return {
      token: signQrToken(Buffer.from(location.qrSecret), location.id, slot),
      validUntil: new Date((slot + 1) * rotation * 1000),
    };
  }

  /** docs/05 §4.3 step 2: the scanned token must be a live token of the verification's location. */
  async verifyQrToken(companyId: string, expectedLocationId: string, token: string): Promise<void> {
    const qrError = (code: string, message: string) =>
      new UnprocessableEntityException({ statusCode: 422, message, error: "Unprocessable Entity", code });
    const parsed = parseQrToken(token);
    if (parsed && parsed.locationId !== expectedLocationId) {
      throw qrError("QR_LOCATION_MISMATCH", "This QR code belongs to another location. Scan the code at the location you checked in at.");
    }
    const location = parsed
      ? await this.prismaService.location.findFirst({
          where: { id: expectedLocationId, companyId, active: true },
          select: { qrSecret: true },
        })
      : null;
    const rotation = location ? await this.qrRotationSeconds(companyId) : 0;
    if (!location || !isValidQrToken(token, Buffer.from(location.qrSecret), Date.now(), rotation)) {
      throw qrError("QR_TOKEN_INVALID", "The QR code is invalid or too old. Scan the code currently shown on the kiosk.");
    }
  }

  async qrRotationSeconds(companyId: string): Promise<number> {
    const setting = await this.prismaService.setting.findUnique({
      where: { companyId_key: { companyId, key: "qr_rotation_seconds" } },
      select: { value: true },
    });
    const value = setting?.value;
    // docs/08 §3.8 default, used when the setting is missing or not a positive whole number.
    return Number.isInteger(value) && (value as number) > 0 ? (value as number) : 30;
  }

  async listUserLocations(companyId: string, targetUserId: string) {
    const employeeId = await this.employeeIdOf(this.prismaService, companyId, targetUserId);
    const rows = await this.prismaService.employeeLocation.findMany({
      where: { companyId, employeeId },
      select: { location: { select: LOCATION_VIEW } },
      orderBy: { location: { name: "asc" } },
    });
    return rows.map((row) => this.toResponse(row.location));
  }

  /** FR-LOC-1: replace the whole set of locations an employee may check in/out at. */
  async setUserLocations(
    companyId: string,
    adminUserId: string,
    targetUserId: string,
    locationIds: string[],
  ) {
    const ids = [...new Set(locationIds)];
    return this.prismaService.$transaction(async (tx) => {
      const employeeId = await this.employeeIdOf(tx, companyId, targetUserId);
      const locations = await tx.location.findMany({
        where: { id: { in: ids }, companyId, active: true },
        orderBy: { name: "asc" },
        select: LOCATION_VIEW,
      });
      if (locations.length !== ids.length) {
        throw new BadRequestException(
          "Every location must be an active location of your company",
        );
      }

      const before = await tx.employeeLocation.findMany({
        where: { companyId, employeeId },
        select: { locationId: true },
      });
      await tx.employeeLocation.deleteMany({ where: { companyId, employeeId } });
      if (ids.length) {
        await tx.employeeLocation.createMany({
          data: ids.map((locationId) => ({ companyId, employeeId, locationId })),
        });
      }

      await this.auditService.record(tx, {
        companyId,
        actorUserId: adminUserId,
        actorType: "ADMIN",
        action: "user.locations_set",
        targetType: "user",
        targetId: targetUserId,
        changes: { before: before.map((row) => row.locationId), after: ids },
      });
      return locations.map((location) => this.toResponse(location));
    });
  }

  private async employeeIdOf(
    db: Prisma.TransactionClient,
    companyId: string,
    userId: string,
  ) {
    const employee = await db.employee.findFirst({
      where: { userId, companyId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException(`User with ID '${userId}' not found`);
    return employee.id;
  }

  async createLocation(userId: string, input: CreateLocationInput) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Location name is required");
    this.assertValidCoordinates(input.latitude, input.longitude);

    try {
      return await this.prismaService.$transaction(async (tx) => {
        const companyId = await this.getAdminCompanyId(tx, userId);

        const location = await tx.location.create({
          data: {
            companyId,
            name,
            latitude: input.latitude,
            longitude: input.longitude,
            radiusM: input.radiusMeters ?? 50,
            qrSecret: randomBytes(32),
          },
        });

        await this.auditService.record(tx, {
          companyId,
          actorUserId: userId,
          actorType: "ADMIN",
          action: "CREATE_LOCATION",
          targetType: "LOCATION",
          targetId: location.id,
          changes: this.toResponse(location),
        });

        return this.toResponse(location);
      });
    } catch (error) {
      this.handleLocationError("create", error);
    }
  }

  async updateLocation(
    userId: string,
    locationId: string,
    input: UpdateLocationDto,
  ) {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException("At least one location field is required");
    }

    if (input.name !== undefined && !input.name.trim()) {
      throw new BadRequestException("Location name is required");
    }
    if (
      input.radiusMeters !== undefined &&
      (!Number.isInteger(input.radiusMeters) || input.radiusMeters <= 0)
    ) {
      throw new BadRequestException("Radius must be a positive integer");
    }

    try {
      return await this.prismaService.$transaction(async (tx) => {
        const companyId = await this.getAdminCompanyId(tx, userId);
        const existing = await tx.location.findFirst({
          where: { id: locationId, companyId },
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            radiusM: true,
            active: true,
          },
        });

        if (!existing) throw new NotFoundException("Location not found");

        const latitude = input.latitude ?? Number(existing.latitude);
        const longitude = input.longitude ?? Number(existing.longitude);
        if (input.latitude !== undefined || input.longitude !== undefined) {
          this.assertValidCoordinates(latitude, longitude);
        }

        const data = {
          ...(input.name !== undefined && { name: input.name.trim() }),
          ...(input.latitude !== undefined && { latitude }),
          ...(input.longitude !== undefined && { longitude }),
          ...(input.radiusMeters !== undefined && {
            radiusM: input.radiusMeters,
          }),
          ...(input.active !== undefined && { active: input.active }),
        };
        const location = await tx.location.update({
          where: { id: existing.id },
          data,
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            radiusM: true,
            active: true,
          },
        });

        await this.auditService.record(tx, {
          companyId,
          actorUserId: userId,
          actorType: "ADMIN",
          action: "UPDATE_LOCATION",
          targetType: "LOCATION",
          targetId: location.id,
          changes: {
            before: this.toResponse(existing),
            after: this.toResponse(location),
          },
        });

        return this.toResponse(location);
      });
    } catch (error) {
      this.handleLocationError("update", error);
    }
  }

  async deleteLocation(userId: string, locationId: string) {
    try {
      return await this.prismaService.$transaction(async (tx) => {
        const companyId = await this.getAdminCompanyId(tx, userId);
        const existing = await tx.location.findFirst({
          where: { id: locationId, companyId },
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            radiusM: true,
            active: true,
          },
        });

        if (!existing) throw new NotFoundException("Location not found");
        if (!existing.active) {
          throw new ConflictException("Location is already inactive");
        }

        const result = await tx.location.updateMany({
          where: { id: existing.id, companyId, active: true },
          data: { active: false },
        });
        if (result.count !== 1) {
          throw new ConflictException("Location is already inactive");
        }

        const location = { ...existing, active: false };
        await this.auditService.record(tx, {
          companyId,
          actorUserId: userId,
          actorType: "ADMIN",
          action: "DELETE_LOCATION",
          targetType: "LOCATION",
          targetId: location.id,
          changes: {
            before: this.toResponse(existing),
            after: this.toResponse(location),
            softDeleted: true,
          },
        });

        return this.toResponse(location);
      });
    } catch (error) {
      this.handleLocationError("delete", error);
    }
  }

  private toResponse(location: {
    id: string;
    name: string;
    latitude: Prisma.Decimal | number;
    longitude: Prisma.Decimal | number;
    radiusM: number;
    active: boolean;
  }) {
    return {
      id: location.id,
      name: location.name,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      radiusMeters: location.radiusM,
      active: location.active,
    };
  }

  private handleLocationError(operation: string, error: unknown): never {
    if (error instanceof HttpException) throw error;

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case "P2002":
          throw new BadRequestException(
            "A location with these details already exists",
          );
        case "P2003":
          throw new BadRequestException("Referenced record does not exist");
        case "P2025":
          throw new NotFoundException("Location not found");
      }
    }

    this.logger.error(
      `Failed to ${operation} location`,
      error instanceof Error ? error.stack : String(error),
    );
    throw new InternalServerErrorException(`Failed to ${operation} location`);
  }

  async isInAllowedLocation(
    userId: string,
    companyId: string,
    operation: "CHECKIN" | "CHECKOUT",
    point: { latitude: number; longitude: number },
  ) {
    try {
      this.assertValidCoordinates(point.latitude, point.longitude);

      // User.id -> Employee, and fetch only locations assigned to this employee
      const employee = await this.prismaService.employee.findFirst({
        where: { userId, companyId, isActive: true },
        select: {
          locations: {
            where: { location: { active: true } },
            select: {
              location: {
                select: {
                  id: true,
                  latitude: true,
                  longitude: true,
                  radiusM: true,
                },
              },
            },
          },
        },
      });

      if (!employee || employee.locations.length === 0) {
        throw new ForbiddenException("You have no assigned location");
      }

      // Check each assigned location against its OWN center and radius
      const match = employee.locations
        .map(({ location }) => ({
          id: location.id,
          radiusM: location.radiusM,
          distanceM: this.distanceInMeters(
            point.latitude,
            point.longitude,
            Number(location.latitude),
            Number(location.longitude),
          ),
        }))
        .find((l) => l.distanceM <= l.radiusM);

      if (!match) {
        throw new ForbiddenException(
          `You are not in an allowed location to ${operation}`,
        );
      }

      return {
        allowed: true,
        locationId: match.id,
        distanceM: Math.round(match.distanceM),
      };
    } catch (error) {
      this.handleLocationError("check allowed location", error);
    }
  }

  private distanceInMeters(
    employeeLat: number,
    employeeLng: number,
    companyLat: number,
    companyLng: number,
  ) {
    const empDLat = toRad(companyLat - employeeLat);
    const empDLng = toRad(companyLng - employeeLng);
    const a =
      Math.sin(empDLat / 2) * Math.sin(empDLat / 2) +
      Math.cos(toRad(employeeLat)) *
        Math.cos(toRad(companyLat)) *
        Math.sin(empDLng / 2) *
        Math.sin(empDLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_M * c;
  }
}
