import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import {
  EmployeeWorkOffersController,
  WorkOffersController,
} from "./work-offers.controller";
import { WorkOffersService } from "./work-offers.service";

@Module({
  imports: [PrismaModule],
  controllers: [WorkOffersController, EmployeeWorkOffersController],
  providers: [WorkOffersService],
  exports: [WorkOffersService],
})
export class WorkOffersModule {}
