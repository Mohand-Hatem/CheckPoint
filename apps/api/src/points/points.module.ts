import { Module } from '@nestjs/common';
import { PointAllocationService } from './point-allocation.service';
import { MyPointsService } from './my-points.service';
import { MyPointsController, PointsController } from './points.controller';
import { PointsService } from './points.service';

@Module({
  controllers: [PointsController, MyPointsController],
  providers: [PointsService, PointAllocationService, MyPointsService],
  exports: [PointsService, PointAllocationService],
})
export class PointsModule {}
