import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateWorkOfferDto } from "./create-work-offer.dto";

describe("CreateWorkOfferDto (AC-REQ-034-01)", () => {
  const base = {
    offerType: "OVERTIME",
    startsAt: "2026-11-10T07:00:00Z",
    endsAt: "2026-11-10T09:00:00Z",
    description: "Additional work",
  };

  it("accepts an OFF_DAY_WORK exception (FR-CAL-2) and rejects unknown types", () => {
    const valid = (offerType: string) =>
      validateSync(plainToInstance(CreateWorkOfferDto, { ...base, offerType, allEmployees: true })).length === 0;
    expect(valid("OFF_DAY_WORK")).toBe(true);
    expect(valid("HOLIDAY_WORK")).toBe(false);
  });

  it("accepts all-company targeting without employee IDs", () => {
    const dto = plainToInstance(CreateWorkOfferDto, {
      ...base,
      allEmployees: true,
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it("requires at least one employee ID for selected-recipient targeting", () => {
    const dto = plainToInstance(CreateWorkOfferDto, {
      ...base,
      allEmployees: false,
    });

    expect(validateSync(dto).map((error) => error.property)).toContain(
      "employeeIds",
    );
  });

  it("accepts one or more employee IDs for selected-recipient targeting", () => {
    const dto = plainToInstance(CreateWorkOfferDto, {
      ...base,
      allEmployees: false,
      employeeIds: [
        "c0ffee00-0000-4000-8000-000000000003",
        "c0ffee00-0000-4000-8000-000000000004",
      ],
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it("requires timezone-aware date-time values for both interval boundaries", () => {
    const dto = plainToInstance(CreateWorkOfferDto, {
      ...base,
      startsAt: "2026-11-10",
      allEmployees: true,
    });

    expect(validateSync(dto).map((error) => error.property)).toContain(
      "startsAt",
    );
  });
});
