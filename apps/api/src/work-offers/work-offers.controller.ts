import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
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
import { CreateWorkOfferDto } from "./dto/create-work-offer.dto";
import { WorkOfferResponseDto } from "./dto/work-offer-response.dto";
import { WorkOffersService } from "./work-offers.service";

@ApiTags("Admin · Work Offers")
@Controller("admin/work-offers")
export class WorkOffersController {
  constructor(private readonly workOffers: WorkOffersService) {}

  @Get()
  @RequirePermission("attendance.read")
  @ApiProtected()
  @ApiNeedsPermission("attendance.read")
  @ApiOperation({
    summary: "List my company work offers",
    description:
      "Returns all work offers for the authenticated Admin’s company; status is computed from the interval and cancellation state.",
  })
  @ApiOkResponse({ type: WorkOfferResponseDto, isArray: true })
  list(@CurrentUser() admin: AuthenticatedUser) {
    return this.workOffers.listForCompany(admin.companyId);
  }

  @Get(":id")
  @RequirePermission("attendance.read")
  @ApiProtected()
  @ApiNeedsPermission("attendance.read")
  @ApiOperation({
    summary: "Get one work offer",
    description:
      "Returns 404 when the offer does not belong to the authenticated Admin’s company.",
  })
  @ApiOkResponse({ type: WorkOfferResponseDto })
  @ApiNotFoundResponse({ description: "Offer not found in this company." })
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.workOffers.findOne(admin.companyId, id);
  }

  @Post()
  @RequirePermission("attendance.write")
  @ApiProtected()
  @ApiNeedsPermission("attendance.write")
  @ApiOperation({
    summary: "Create an early-work or overtime offer",
    description:
      "Creates a company-scoped offer for selected employees or all current and future employees; no acceptance is required.",
  })
  @ApiCreatedResponse({ type: WorkOfferResponseDto })
  @ApiNotFoundResponse({
    description:
      "One or more selected employees are not active in this company.",
  })
  @ApiValidationError()
  create(
    @Body() dto: CreateWorkOfferDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.workOffers.create(admin.companyId, admin.userId, dto);
  }

  @Patch(":id/cancel")
  @RequirePermission("attendance.write")
  @ApiProtected()
  @ApiNeedsPermission("attendance.write")
  @ApiOperation({
    summary: "Cancel a work offer before it starts",
    description:
      "Cancels an offer only before startsAt; the mutation is company-scoped and audited.",
  })
  @ApiOkResponse({ type: WorkOfferResponseDto })
  @ApiConflictResponse({
    description:
      "The offer has started, has completed, or was already cancelled.",
  })
  @ApiNotFoundResponse({ description: "Offer not found in this company." })
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.workOffers.cancel(admin.companyId, admin.userId, id);
  }
}

@ApiTags("Employee · Work Offers")
@Controller("employee/work-offers")
export class EmployeeWorkOffersController {
  constructor(private readonly workOffers: WorkOffersService) {}

  @Get()
  @ApiProtected()
  @ApiOperation({
    summary: "List my visible work offers",
    description:
      "Returns offers addressed to the authenticated employee or all employees in their company; no acceptance is required.",
  })
  @ApiOkResponse({ type: WorkOfferResponseDto, isArray: true })
  @ApiNotFoundResponse({
    description: "No active employee profile is associated with this account.",
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.workOffers.listForEmployee(user.companyId, user.userId);
  }
}
