import { Module } from "@nestjs/common";
import { LocationController, UserLocationsController } from "./location.controller";
import { LocationService } from "./location.service";

@Module({
  controllers: [LocationController, UserLocationsController],
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule {}
