import { Module } from "@nestjs/common";
import { CompanyPolicyService } from "../company/company-policy.service";
import { PrismaService } from "../prisma/prisma.service";
import { WorkOffersService } from "../work-offers/work-offers.service";
import { SalaryCalculationService } from "./salaryCalculation.service";
import { SalaryCronService } from "./salaryCalculation.schedule";

@Module({
  exports: [],
  imports: [],
  providers: [
    SalaryCalculationService,
    SalaryCronService,
    PrismaService,
    WorkOffersService,
    CompanyPolicyService,
  ],
})
export class SalaryCalcuationModule {}
