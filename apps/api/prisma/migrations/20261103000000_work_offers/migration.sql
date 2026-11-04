CREATE TYPE "WorkOfferType" AS ENUM ('OFF_DAY_WORK', 'EARLY_WORK', 'OVERTIME');
CREATE TYPE "WorkOfferStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

ALTER TABLE "work_offers" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "work_offers"
  ALTER COLUMN "employee_id" DROP NOT NULL,
  ADD COLUMN "all_employees" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "offer_type" TYPE "WorkOfferType" USING ("offer_type"::"WorkOfferType"),
  ALTER COLUMN "status" TYPE "WorkOfferStatus" USING ("status"::"WorkOfferStatus"),
  ADD CONSTRAINT "work_offers_all_employees_target_check"
    CHECK (NOT "all_employees" OR "employee_id" IS NULL),
  ADD CONSTRAINT "work_offers_interval_check"
    CHECK ("ends_at" > "starts_at");

ALTER TABLE "work_offers" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP INDEX "work_offers_employee_start_idx";
CREATE UNIQUE INDEX "employees_company_id_key" ON "employees"("company_id", "id");
CREATE UNIQUE INDEX "work_offers_company_id_key" ON "work_offers"("company_id", "id");
CREATE INDEX "work_offers_company_start_idx" ON "work_offers"("company_id", "starts_at");
CREATE INDEX "work_offers_company_employee_idx" ON "work_offers"("company_id", "employee_id");

CREATE TABLE "work_offer_recipients" (
  "company_id" UUID NOT NULL,
  "work_offer_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,

  CONSTRAINT "work_offer_recipients_pkey" PRIMARY KEY ("work_offer_id", "employee_id")
);

CREATE INDEX "work_offer_recipients_employee_idx"
  ON "work_offer_recipients"("company_id", "employee_id", "work_offer_id");

ALTER TABLE "work_offer_recipients"
  ADD CONSTRAINT "work_offer_recipients_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "work_offer_recipients_company_work_offer_fkey"
    FOREIGN KEY ("company_id", "work_offer_id")
    REFERENCES "work_offers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "work_offer_recipients_company_employee_fkey"
    FOREIGN KEY ("company_id", "employee_id")
    REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
