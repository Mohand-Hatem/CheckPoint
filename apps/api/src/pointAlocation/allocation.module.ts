import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { PointAllocationService } from "./allocation.service";
import { PointAllocationProcessor } from "./allocation.proccessor";
import { PointAllocationQueue } from "./allocation.constants";

export { PointAllocationQueue };

@Module({
  exports: [PointAllocationService],
  imports: [BullModule.registerQueue({ name: PointAllocationQueue })],
  controllers: [],
  providers: [PointAllocationService, PointAllocationProcessor],
})
export class PointAllocationModule {}
