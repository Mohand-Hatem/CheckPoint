import { Module } from "@nestjs/common";
import { AttendanceModule } from "../attendance/attendance.module";
import { EmployeesModule } from "../employees/employees.module";
import { LocationModule } from "../location/location.module";
import { PointsModule } from "../points/points.module";
import { WorkOffersModule } from "../work-offers/work-offers.module";
import { CheckService } from "./check.service";

@Module({
  imports: [
    AttendanceModule,
    WorkOffersModule,
    LocationModule,
    PointsModule,
    EmployeesModule,
  ],
  controllers: [],
  providers: [CheckService],
  exports: [CheckService],
})
export class CheckModule {}
