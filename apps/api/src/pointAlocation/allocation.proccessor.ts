import { Processor, WorkerHost } from "@nestjs/bullmq";
import { PointAllocationQueue } from "./allocation.constants";
import { AllocationResult, PointAllocationService } from "./allocation.service";
import { Job } from "bullmq";

@Processor(PointAllocationQueue)
export class PointAllocationProcessor extends WorkerHost {
  constructor(private readonly pointAllocationService: PointAllocationService) {
    super();
  }

  async process(job: Job): Promise<AllocationResult> {
    switch (job.name) {
      case "allocate-points":
        return this.pointAllocationService.saveAllocations(
          job.data.companyId,
          job.data.employeeId,
        );
      default:
        throw new Error(`Unsupported point allocation job: ${job.name}`);
    }
  }
}
