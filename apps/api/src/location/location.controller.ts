import {
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Body,
} from "@nestjs/common";
import {
  ApiConflictResponse,
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
import { LocationResponseDto } from "./dto/location-response.dto";
import { UpdateLocationDto } from "./dto/update-location-dto";
import { LocationService } from "./location.service";

@ApiTags("Admin · Locations")
@Controller("admin/locations")
export class LocationController {
  constructor(private readonly locations: LocationService) {}

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
