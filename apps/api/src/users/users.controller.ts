import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermission('users.write')
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.usersService.createUser(dto, admin.userId);
  }

  @Get()
  @RequirePermission('users.read')
  async getUsers(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('active') active?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const activeBool =
      active === 'true' ? true : active === 'false' ? false : undefined;

    return this.usersService.getUsers(
      pageNum,
      limitNum,
      search,
      role,
      activeBool,
    );
  }

  @Get(':id')
  @RequirePermission('users.read')
  async getUserById(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }

  @Patch(':id/status')
  @RequirePermission('users.write')
  async updateUserStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateUserStatus(id, dto.active);
  }

  @Post(':id/salaries')
  @RequirePermission('users.write')
  async createSalary(
    @Param('id') id: string,
    @Body() dto: CreateSalaryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.usersService.createSalary(id, dto, admin.userId);
  }
}
