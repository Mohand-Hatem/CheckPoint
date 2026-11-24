import { Module } from "@nestjs/common";
import { CompanyPolicyService } from "src/company/company-policy.service";
import { PrismaService } from "src/prisma/prisma.service";
import { WorkOffersService } from "src/work-offers/work-offers.service";

@Module({
    exports : [] , 
    imports : [PrismaService,WorkOffersService , CompanyPolicyService] , 
    providers:[]
})

export class SalaryCalcuationModule {}