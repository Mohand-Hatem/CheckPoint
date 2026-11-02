-- Integrity rules the database enforces itself (docs/08). Prisma's schema language cannot express
-- partial unique indexes, CHECK constraints or exclusion constraints, so they live here as raw SQL.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Invitations: at most one PENDING invitation per company and email, and per company and employee code.
CREATE UNIQUE INDEX "company_invitations_pending_email_key"
  ON "company_invitations" ("company_id", "email") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "company_invitations_pending_employee_number_key"
  ON "company_invitations" ("company_id", "employee_number") WHERE "status" = 'PENDING';

-- Identity: lower-case emails (they are globally unique).
-- (One role per user is declared in schema.prisma as user_roles_one_role_per_user_key, part of the baseline.)
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));

-- Money and points: positive salary and point values; WHITE never has a money value.
ALTER TABLE "employee_compensation_versions"
  ADD CONSTRAINT "employee_compensation_salary_positive_check" CHECK ("salary" > 0);
ALTER TABLE "point_value_versions"
  ADD CONSTRAINT "point_value_positive_check" CHECK ("value" > 0),
  ADD CONSTRAINT "point_value_no_white_check" CHECK ("point_type" <> 'WHITE');

-- Schedules: GREEN < WHITE < RED windows in order (spec REQ-012); no overlapping assignments per employee.
ALTER TABLE "shift_versions"
  ADD CONSTRAINT "shift_versions_windows_ordered_check"
  CHECK ("early_minutes" > 0 AND "early_minutes" < "grace_minutes" AND "grace_minutes" < "red_period_minutes");
ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_no_overlap_excl"
  EXCLUDE USING gist ("employee_id" WITH =, daterange("effective_from", "effective_to", '[]') WITH &&);
