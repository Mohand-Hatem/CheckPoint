import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Body,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import {
  AuthenticatedUser,
  CurrentUser,
} from "../auth/decorators/current-user.decorator";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import {
  ApiNeedsPermission,
  ApiProtected,
  ApiValidationError,
} from "../common/api-docs";
import { CreateLocationDto, SetUserLocationsDto } from "./dto/add-location-dto";
import { LocationResponseDto, QrTokenResponseDto } from "./dto/location-response.dto";
import { UpdateLocationDto } from "./dto/update-location-dto";
import { LocationService } from "./location.service";

@ApiTags("Admin · Locations")
@Controller("admin/locations")
export class LocationController {
  constructor(private readonly locations: LocationService) {}

  @Post()
  @RequirePermission("settings.write")
  @ApiProtected()
  @ApiNeedsPermission("settings.write")
  @ApiOperation({
    summary: "Create a company location (FR-LOC-1)",
    description:
      "Adds a geofence (center and radius, default 50 m) where employees can check in and out. A random QR secret is generated and never returned. The creation is audited.",
  })
  @ApiCreatedResponse({ type: LocationResponseDto })
  @ApiValidationError()
  create(@Body() dto: CreateLocationDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.locations.createLocation(admin.userId, dto);
  }

  @Get()
  @RequirePermission("settings.read")
  @ApiProtected()
  @ApiNeedsPermission("settings.read")
  @ApiOperation({ summary: "List the company's locations (active and inactive), by name" })
  @ApiOkResponse({ type: LocationResponseDto, isArray: true })
  list(@CurrentUser() admin: AuthenticatedUser) {
    return this.locations.listLocations(admin.companyId);
  }

  @Get(":id/qr-token")
  @RequirePermission("settings.read")
  @ApiProtected()
  @ApiNeedsPermission("settings.read")
  @ApiOperation({
    summary: "Current rotating QR token for the kiosk (docs/05 §4.5)",
    description:
      "Signed with the location's secret and valid for the current and the next rotation period (qr_rotation_seconds, default 30 s). Show a new token by `validUntil`. Tokens are never stored; an inactive location answers 409.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: QrTokenResponseDto })
  @ApiNotFoundResponse({ description: "Location not found in this company." })
  @ApiConflictResponse({ description: "Location is inactive." })
  qrToken(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.locations.getQrToken(admin.companyId, id);
  }

  @Get(":id")
  @RequirePermission("settings.read")
  @ApiProtected()
  @ApiNeedsPermission("settings.read")
  @ApiOperation({ summary: "One company location" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: LocationResponseDto })
  @ApiNotFoundResponse({ description: "Location not found in this company." })
  findOne(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.locations.getLocation(admin.companyId, id);
  }

  @Patch(":id")
  @RequirePermission("settings.write")
  @ApiProtected()
  @ApiNeedsPermission("settings.write")
  @ApiOperation({
    summary: "Update a company location",
    description:
      "Updates the supplied name, coordinates, radius, or active state for a location in the Admin's company. The change is audited.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: LocationResponseDto })
  @ApiNotFoundResponse({ description: "Location not found in this company." })
  @ApiValidationError()
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.locations.updateLocation(admin.userId, id, dto);
  }

  @Delete(":id")
  @RequirePermission("settings.write")
  @ApiProtected()
  @ApiNeedsPermission("settings.write")
  @ApiOperation({
    summary: "Deactivate a company location",
    description:
      "Soft-deletes a location by setting active=false. Its assignments and history are retained; the mutation is audited.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: LocationResponseDto })
  @ApiConflictResponse({ description: "Location is already inactive." })
  @ApiNotFoundResponse({ description: "Location not found in this company." })
  delete(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.locations.deleteLocation(admin.userId, id);
  }
}

@ApiTags("Admin · Users")
@Controller("admin/users")
export class UserLocationsController {
  constructor(private readonly locations: LocationService) {}

  @Get(":id/locations")
  @RequirePermission("users.read")
  @ApiProtected()
  @ApiNeedsPermission("users.read")
  @ApiOperation({ summary: "Locations where this employee may check in and out" })
  @ApiParam({ name: "id", format: "uuid", description: "User id" })
  @ApiOkResponse({ type: LocationResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: "No employee with this user id in your company." })
  list(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.locations.listUserLocations(admin.companyId, id);
  }

  @Put(":id/locations")
  @RequirePermission("users.write")
  @ApiProtected()
  @ApiNeedsPermission("users.write")
  @ApiOperation({
    summary: "Replace an employee's locations (FR-LOC-1)",
    description:
      "Sets the complete list of locations where the employee may check in and out; an empty list removes all. Every id must be an active location of your company, otherwise nothing changes (400). Audited with before/after.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "User id" })
  @ApiOkResponse({ type: LocationResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: "No employee with this user id in your company." })
  @ApiValidationError()
  set(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetUserLocationsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.locations.setUserLocations(admin.companyId, admin.userId, id, dto.locationIds);
  }
}
