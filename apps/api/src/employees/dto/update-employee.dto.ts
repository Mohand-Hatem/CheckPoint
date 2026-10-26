import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateEmployeeDto } from './create-employee.dto';

// الـ email مش بيتعدل هنا: تغيير الـ login له تبعات أمنية (قرار مؤجل).
export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, ['email'] as const),
) {}