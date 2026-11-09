-- FR-ATT-1/2: GPS-validated check-ins waiting for the kiosk QR scan (docs/05 §4.2-4.3).
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED');

CREATE TABLE "attendance_verifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "location_id" UUID NOT NULL,
  "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(6),
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "accuracy_m" DECIMAL(7,2) NOT NULL,

  CONSTRAINT "attendance_verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_verifications_expiry_check" CHECK ("expires_at" > "started_at"),
  CONSTRAINT "attendance_verifications_confirmed_check" CHECK (("status" = 'CONFIRMED') = ("confirmed_at" IS NOT NULL))
);

CREATE INDEX "attendance_verifications_employee_date_idx"
  ON "attendance_verifications"("company_id", "employee_id", "work_date");

-- Concurrent step-1 requests: only one PENDING verification per employee and day can exist.
CREATE UNIQUE INDEX "attendance_verifications_one_pending_key"
  ON "attendance_verifications"("employee_id", "work_date") WHERE "status" = 'PENDING';

ALTER TABLE "attendance_verifications"
  ADD CONSTRAINT "attendance_verifications_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_verifications_company_employee_fkey"
    FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_verifications_company_location_fkey"
    FOREIGN KEY ("company_id", "location_id") REFERENCES "locations"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
