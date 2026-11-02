import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { UpdateUserStatusDto } from '../users/dto/update-user-status.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListEmployeesQuery } from './dto/list-employees.query';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

@Controller('admin/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Post()
  @RequirePermission('users.write')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.employees.create(admin.companyId, admin.userId, dto);
  }

  @Get()
  @RequirePermission('users.read')
  findAll(@Query() query: ListEmployeesQuery, @CurrentUser() admin: AuthenticatedUser) {
    return this.employees.findAll(admin.companyId, query);
  }

  @Get(':id')
  @RequirePermission('users.read')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.employees.findOne(admin.companyId, id);
  }

  @Patch(':id')
  @RequirePermission('users.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.employees.update(admin.companyId, admin.userId, id, dto);
  }

  @Patch(':id/status')
  @RequirePermission('users.write')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.employees.setActive(admin.companyId, admin.userId, id, dto.active);
  }

  @Post(':id/invitation/resend')
  @RequirePermission('users.write')
  resendInvitation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.employees.resendInvitation(admin.companyId, admin.userId, id);
  }

  @Post(':id/invitation/revoke')
  @RequirePermission('users.write')
  revokeInvitation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.employees.revokeInvitation(admin.companyId, admin.userId, id);
  }
}

@Controller('auth/invitations')
export class InvitationsController {
  constructor(private readonly employees: EmployeesService) {}

  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  accept(@Body() dto: AcceptInvitationDto) {
    return this.employees.acceptInvitation(dto);
  }
}
