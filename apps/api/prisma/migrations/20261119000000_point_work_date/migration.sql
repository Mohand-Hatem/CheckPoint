-- Every point belongs to a Cairo work date (05 §5.3, 08 point_ledger_entries, C-22):
-- it decides the payroll month and the offset order (work_date, created_at, id).
ALTER TABLE "point_ledger_entries" ADD COLUMN "work_date" DATE;

-- Backfill only: the ledger is append-only, so its UPDATE guard is off for these three statements.
ALTER TABLE "point_ledger_entries" DISABLE TRIGGER "point_ledger_entries_no_update";

-- Attendance, overtime and early-checkout awards: the attendance day they came from.
UPDATE "point_ledger_entries" p
SET "work_date" = d."work_date"
FROM "attendance_days" d
WHERE p."source_id" = d."id"
  AND p."source_type" IN ('ATTENDANCE', 'OVERTIME', 'EARLY_CHECKOUT')
  AND p."reverses_entry_id" IS NULL;

-- Other awards (admin): the Cairo date they were written.
UPDATE "point_ledger_entries"
SET "work_date" = ("created_at" AT TIME ZONE 'Africa/Cairo')::date
WHERE "work_date" IS NULL AND "reverses_entry_id" IS NULL;

-- A reversal belongs to the same day as the entry it reverses.
UPDATE "point_ledger_entries" p
SET "work_date" = t."work_date"
FROM "point_ledger_entries" t
WHERE p."reverses_entry_id" = t."id";

ALTER TABLE "point_ledger_entries" ENABLE TRIGGER "point_ledger_entries_no_update";

ALTER TABLE "point_ledger_entries" ALTER COLUMN "work_date" SET NOT NULL;
CREATE INDEX "point_ledger_employee_work_date_idx" ON "point_ledger_entries"("company_id", "employee_id", "work_date");
