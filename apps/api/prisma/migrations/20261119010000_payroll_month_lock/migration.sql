-- Locked payroll months (FR-PTS-4, 08 payroll_months, C-23). Phase 4 adds the table and the guards;
-- Month Close (Phase 6) is the only writer of LOCKED. A month with no row is OPEN.
CREATE TYPE "month_status" AS ENUM ('OPEN', 'LOCKED');

CREATE TABLE "payroll_months" (
    "company_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "status" "month_status" NOT NULL DEFAULT 'OPEN',
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" UUID,

    CONSTRAINT "payroll_months_pkey" PRIMARY KEY ("company_id", "month"),
    CONSTRAINT "payroll_months_first_day" CHECK (EXTRACT(DAY FROM "month") = 1),
    CONSTRAINT "payroll_months_locked_has_actor" CHECK ("status" = 'OPEN' OR ("locked_at" IS NOT NULL AND "locked_by" IS NOT NULL))
);

ALTER TABLE "payroll_months" ADD CONSTRAINT "payroll_months_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_months" ADD CONSTRAINT "payroll_months_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A LOCKED month never changes again.
CREATE FUNCTION "payroll_months_keep_locked"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'LOCKED' THEN
    RAISE EXCEPTION 'MONTH_LOCKED: payroll month % is locked', OLD."month";
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_months_locked_no_change"
  BEFORE UPDATE OR DELETE ON "payroll_months" FOR EACH ROW EXECUTE FUNCTION "payroll_months_keep_locked"();

CREATE FUNCTION "payroll_month_is_locked"(company UUID, work_date DATE) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "payroll_months"
    WHERE "company_id" = company
      AND "month" = date_trunc('month', work_date)::date
      AND "status" = 'LOCKED'
  );
$$ LANGUAGE sql STABLE;

-- No point (award or reversal) for a locked month.
CREATE FUNCTION "point_ledger_entries_month_open"() RETURNS trigger AS $$
BEGIN
  IF "payroll_month_is_locked"(NEW."company_id", NEW."work_date") THEN
    RAISE EXCEPTION 'MONTH_LOCKED: payroll month of % is locked', NEW."work_date";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "point_ledger_entries_month_guard"
  BEFORE INSERT ON "point_ledger_entries" FOR EACH ROW EXECUTE FUNCTION "point_ledger_entries_month_open"();

-- No offset row (APPLY or UNDO) that touches a locked-month Green or penalty.
CREATE FUNCTION "point_offset_allocations_months_open"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "point_ledger_entries" p
    WHERE p."id" IN (NEW."green_entry_id", NEW."penalty_entry_id")
      AND "payroll_month_is_locked"(p."company_id", p."work_date")
  ) THEN
    RAISE EXCEPTION 'MONTH_LOCKED: an offset point belongs to a locked payroll month';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "point_offset_allocations_month_guard"
  BEFORE INSERT ON "point_offset_allocations" FOR EACH ROW EXECUTE FUNCTION "point_offset_allocations_months_open"();
