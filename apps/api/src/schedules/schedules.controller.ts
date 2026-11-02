import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AssignShiftDto } from './dto/assign-shift.dto';
import { CreateCompanyPolicyVersionDto } from './dto/create-company-policy-version.dto';
import { CreateShiftDto } from './dto/create-shift.dto';
import { CreateShiftVersionDto } from './dto/create-shift-version.dto';
import { SchedulesService } from './schedules.service';

@ApiTags('Admin · Schedules')
@Controller('admin')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get('company-policy')
  @RequirePermission('settings.read')
  @ApiProtected()
  @ApiNeedsPermission('settings.read')
  @ApiOperation({ summary: 'Company timezone and policy versions' })
  @ApiOkResponse({ description: 'Success' })
  getCompanyPolicy(@CurrentUser() admin: AuthenticatedUser) {
    return this.schedules.getCompanyPolicy(admin.companyId);
  }

  @Post('company-policy/versions')
  @RequirePermission('settings.write')
  @ApiProtected()
  @ApiNeedsPermission('settings.write')
  @ApiOperation({ summary: 'Add a company policy version' })
  @ApiCreatedResponse({ description: 'Success' })
  @ApiValidationError()
  createCompanyPolicyVersion(
    @Body() dto: CreateCompanyPolicyVersionDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.schedules.createCompanyPolicyVersion(
      admin.companyId,
      admin.userId,
      dto,
    );
  }

  @Get('shifts')
  @RequirePermission('settings.read')
  @ApiProtected()
  @ApiNeedsPermission('settings.read')
  @ApiOperation({ summary: 'List shifts with their versions' })
  @ApiOkResponse({ description: 'Success' })
  listShifts(@CurrentUser() admin: AuthenticatedUser) {
    return this.schedules.listShifts(admin.companyId);
  }

  @Get('shifts/:id')
  @RequirePermission('settings.read')
  @ApiProtected()
  @ApiNeedsPermission('settings.read')
  @ApiOperation({ summary: 'Get one shift with versions and assignments' })
  @ApiOkResponse({ description: 'Success' })
  getShift(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.schedules.getShift(admin.companyId, id);
  }

  @Post('shifts')
  @RequirePermission('settings.write')
  @ApiProtected()
  @ApiNeedsPermission('settings.write')
  @ApiOperation({ summary: 'Create a shift with its first version' })
  @ApiCreatedResponse({ description: 'Success' })
  @ApiValidationError()
  createShift(
    @Body() dto: CreateShiftDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.schedules.createShift(admin.companyId, admin.userId, dto);
  }

  @Post('shifts/:id/versions')
  @RequirePermission('settings.write')
  @ApiProtected()
  @ApiNeedsPermission('settings.write')
  @ApiOperation({ summary: 'Add a shift version from a date' })
  @ApiCreatedResponse({ description: 'Success' })
  @ApiValidationError()
  createShiftVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateShiftVersionDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.schedules.createShiftVersion(
      admin.companyId,
      id,
      admin.userId,
      dto,
    );
  }

  @Post('shifts/:id/assignments')
  @RequirePermission('settings.write')
  @ApiProtected()
  @ApiNeedsPermission('settings.write')
  @ApiOperation({ summary: 'Assign an employee to a shift from a date' })
  @ApiCreatedResponse({ description: 'Success' })
  @ApiValidationError()
  assignShift(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignShiftDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.schedules.assignShift(admin.companyId, id, admin.userId, dto);
  }
}
