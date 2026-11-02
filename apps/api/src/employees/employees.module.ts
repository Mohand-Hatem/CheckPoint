import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmployeesController, InvitationsController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeesController, InvitationsController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
