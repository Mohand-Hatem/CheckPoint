-- FR-CAL-1: company holidays (weekly off days stay in settings.weekly_off_days).
CREATE TABLE "holidays" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "holiday_date" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "holidays_name_not_blank" CHECK (btrim("name") <> '')
);

CREATE UNIQUE INDEX "holidays_company_date_key" ON "holidays"("company_id", "holiday_date");

ALTER TABLE "holidays"
  ADD CONSTRAINT "holidays_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "holidays_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
