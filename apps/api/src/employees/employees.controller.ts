import {
 Controller
} from '@nestjs/common';
import { EmployeesService } from './employees.service';

interface AuthUser { id: string; companyId: string; roles: string[] }

@Controller('admin/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  
}