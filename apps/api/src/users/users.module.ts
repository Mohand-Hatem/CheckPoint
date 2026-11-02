import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployeesModule } from '../employees/employees.module';
import { MeController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, EmployeesModule],
  controllers: [UsersController, MeController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
