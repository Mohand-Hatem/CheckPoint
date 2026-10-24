import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module'; // ASSUMPTION
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService], // الـ offers/shifts تستخدم eligibleEmployeesWhere
})
export class EmployeesModule {}