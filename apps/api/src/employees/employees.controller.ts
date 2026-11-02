import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { UpdateUserStatusDto } from '../users/dto/update-user-status.dto';
import { ListEmployeesQuery } from './dto/list-employees.query';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

// New employees join through POST /admin/invitations or POST /admin/users.
@ApiTags('Admin · Employees')
@Controller('admin/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission('users.read')
  @ApiProtected()
  @ApiNeedsPermission('users.read')
  @ApiOperation({ summary: 'List employees of my company', description: 'Search by name, employee number or phone; filter by `isActive`. Paginated, newest first.' })
  @ApiOkResponse({ description: 'Success' })
  findAll(@Query() query: ListEmployeesQuery, @CurrentUser() admin: AuthenticatedUser) {
    return this.employees.findAll(admin.companyId, query);
  }

  @Get(':id')
  @RequirePermission('users.read')
  @ApiProtected()
  @ApiNeedsPermission('users.read')
  @ApiOperation({ summary: 'Get one employee with shift history', description: "Another company's employee returns 404, like one that does not exist." })
  @ApiOkResponse({ description: 'Success' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.employees.findOne(admin.companyId, id);
  }

  @Patch(':id')
  @RequirePermission('users.write')
  @ApiProtected()
  @ApiNeedsPermission('users.write')
  @ApiOperation({ summary: 'Edit name, phone or employee number', description: 'Email and shift are not edited here. A duplicate employee number returns 409. Audited with before/after.' })
  @ApiOkResponse({ description: 'Success' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiValidationError()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.employees.update(admin.companyId, admin.userId, id, dto);
  }

  @Patch(':id/status')
  @RequirePermission('users.write')
  @ApiProtected()
  @ApiNeedsPermission('users.write')
  @ApiOperation({ summary: 'Activate or deactivate an employee', description: 'Deactivation ends all sessions and keeps history. An Admin cannot deactivate their own account. Reactivation restarts the absence window on the company date.' })
  @ApiOkResponse({ description: 'Success' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiValidationError()
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.employees.setActive(admin.companyId, admin.userId, id, dto.active);
  }
}
