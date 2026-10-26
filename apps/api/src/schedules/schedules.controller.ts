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

@Controller('admin')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get('company-policy')
  @RequirePermission('settings.read')
  getCompanyPolicy(@CurrentUser() admin: AuthenticatedUser) {
    return this.schedules.getCompanyPolicy(admin.companyId);
  }

  @Post('company-policy/versions')
  @RequirePermission('settings.write')
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
  listShifts(@CurrentUser() admin: AuthenticatedUser) {
    return this.schedules.listShifts(admin.companyId);
  }

  @Get('shifts/:id')
  @RequirePermission('settings.read')
  getShift(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.schedules.getShift(admin.companyId, id);
  }

  @Post('shifts')
  @RequirePermission('settings.write')
  createShift(
    @Body() dto: CreateShiftDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.schedules.createShift(admin.companyId, admin.userId, dto);
  }

  @Post('shifts/:id/versions')
  @RequirePermission('settings.write')
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
  assignShift(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignShiftDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.schedules.assignShift(admin.companyId, id, admin.userId, dto);
  }
}
