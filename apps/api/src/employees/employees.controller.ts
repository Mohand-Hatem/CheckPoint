import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';

import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListEmployeesQuery } from './dto/list-employees.query';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

interface AuthenticatedUser {
  userId: string;
  email: string;
  companyId: string;
  role: string;
  permissions: string[];
}

@Controller('admin/employees')
@RequirePermission('users.write')
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.employeesService.create(
      user.companyId,
      user.userId,
      dto,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEmployeesQuery,
  ) {
    return this.employeesService.findAll(
      user.companyId,
      query,
    );
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
  ) {
    return this.employeesService.findOne(
      user.companyId,
      employeeId,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(
      user.companyId,
      employeeId,
      dto,
    );
  }

  @Patch(':id/activate')
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
  ) {
    return this.employeesService.setActive(
      user.companyId,
      employeeId,
      true,
    );
  }

  @Patch(':id/deactivate')
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
  ) {
    return this.employeesService.setActive(
      user.companyId,
      employeeId,
      false,
    );
  }
}