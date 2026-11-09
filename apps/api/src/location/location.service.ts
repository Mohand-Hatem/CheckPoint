import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateLocationDto } from "./dto/update-location-dto";

type CreateLocationInput = {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

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

  async createLocation(userId: string, input: CreateLocationInput) {
    this.assertValidCoordinates(input.latitude, input.longitude);

    try {
      return await this.prismaService.$transaction(async (tx) => {
        const companyId = await this.getAdminCompanyId(tx, userId);

        const location = await tx.location.create({
          data: {
            companyId,
            name: input.name,
            latitude: input.latitude,
            longitude: input.longitude,
            radiusM: input.radiusMeters,
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
          changes: { ...input },
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
