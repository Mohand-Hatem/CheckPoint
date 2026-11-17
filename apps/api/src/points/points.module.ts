import { Module } from '@nestjs/common';
import { PointAllocationService } from './point-allocation.service';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';

@Module({
  controllers: [PointsController],
  providers: [PointsService, PointAllocationService],
  exports: [PointsService, PointAllocationService],
})
export class PointsModule {}
