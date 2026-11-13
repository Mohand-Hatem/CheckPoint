import type { Job } from "bullmq";
import { PointAllocationService } from "./allocation.service";
import { PointAllocationProcessor } from "./allocation.proccessor";

jest.mock("@nestjs/bullmq", () => ({
  BullModule: { registerQueue: () => ({}) },
  Processor: () => () => undefined,
  WorkerHost: class {},
}));

describe("PointAllocationProcessor", () => {
  const service = {
    saveAllocations: jest.fn(),
  };
  const processor = new PointAllocationProcessor(
    service as unknown as PointAllocationService,
  );

  beforeEach(() => {
    service.saveAllocations.mockReset();
  });

  it("TEST-ALLOC-05 (FR-PTS-2): dispatches allocation jobs using their company and employee identifiers", async () => {
    const result = { message: "1 green point(s) used to offset 1 red point(s)." };
    service.saveAllocations.mockResolvedValue(result);
    const job = {
      name: "allocate-points",
      data: { companyId: "company-1", employeeId: "employee-1" },
    } as Job;

    await expect(processor.process(job)).resolves.toBe(result);
    expect(service.saveAllocations).toHaveBeenCalledWith(
      "company-1",
      "employee-1",
    );
  });

  it("TEST-ALLOC-06: rejects unsupported job names instead of silently completing them", async () => {
    const job = {
      name: "unknown-job",
      data: {},
    } as Job;

    await expect(processor.process(job)).rejects.toThrow(
      "Unsupported point allocation job: unknown-job",
    );
    expect(service.saveAllocations).not.toHaveBeenCalled();
  });
});
