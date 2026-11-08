import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { UpdateLocationDto } from "./update-location-dto";

describe("UpdateLocationDto", () => {
  it("accepts a partial update of location details", () => {
    const dto = plainToInstance(UpdateLocationDto, {
      name: "Main Office",
      radiusMeters: 75,
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it("accepts an active-state update for deactivation or reactivation", () => {
    const dto = plainToInstance(UpdateLocationDto, { active: false });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it("rejects a non-positive radius", () => {
    const dto = plainToInstance(UpdateLocationDto, { radiusMeters: 0 });

    expect(validateSync(dto).map((error) => error.property)).toContain(
      "radiusMeters",
    );
  });

  it("rejects null values instead of treating them as omitted", () => {
    const dto = plainToInstance(UpdateLocationDto, { name: null });

    expect(validateSync(dto).map((error) => error.property)).toContain("name");
  });
});
