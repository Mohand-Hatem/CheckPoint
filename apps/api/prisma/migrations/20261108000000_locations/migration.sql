CREATE TABLE "locations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "radius_m" INTEGER NOT NULL DEFAULT 50,
  "qr_secret" BYTEA NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "locations_radius_positive_check" CHECK ("radius_m" > 0),
  CONSTRAINT "locations_latitude_range_check" CHECK ("latitude" BETWEEN -90 AND 90),
  CONSTRAINT "locations_longitude_range_check" CHECK ("longitude" BETWEEN -180 AND 180)
);

CREATE UNIQUE INDEX "locations_company_id_key" ON "locations"("company_id", "id");
CREATE INDEX "locations_company_idx" ON "locations"("company_id");

CREATE TABLE "employee_locations" (
  "company_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,

  CONSTRAINT "employee_locations_pkey" PRIMARY KEY ("employee_id", "location_id")
);

CREATE INDEX "employee_locations_company_employee_idx"
  ON "employee_locations"("company_id", "employee_id");
CREATE INDEX "employee_locations_company_location_idx"
  ON "employee_locations"("company_id", "location_id");

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_locations"
  ADD CONSTRAINT "employee_locations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_locations_company_employee_fkey"
    FOREIGN KEY ("company_id", "employee_id")
    REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_locations_company_location_fkey"
    FOREIGN KEY ("company_id", "location_id")
    REFERENCES "locations"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
