-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CompanyInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PointType" AS ENUM ('GREEN', 'WHITE', 'RED', 'BLACK');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "employee_number" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "CompanyInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by_user_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "current_shift_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "active_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_policy_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL,
    "monthly_hours_divisor" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_compensation_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "salary" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_compensation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "early_minutes" INTEGER NOT NULL DEFAULT 60,
    "grace_minutes" INTEGER NOT NULL,
    "red_period_minutes" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_version_weekdays" (
    "shift_version_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,

    CONSTRAINT "shift_version_weekdays_pkey" PRIMARY KEY ("company_id","shift_version_id","weekday")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "assigned_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "shift_assignment_id" UUID,
    "work_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduled_start_at" TIMESTAMPTZ(6) NOT NULL,
    "early_end_at" TIMESTAMPTZ(6) NOT NULL,
    "grace_end_at" TIMESTAMPTZ(6) NOT NULL,
    "red_period_end_at" TIMESTAMPTZ(6) NOT NULL,
    "scheduled_end_at" TIMESTAMPTZ(6) NOT NULL,
    "check_in_at" TIMESTAMPTZ(6),
    "check_out_at" TIMESTAMPTZ(6),
    "check_in_result" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "classification" "PointType",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_excuses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "attendance_day_id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "employee_reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by_user_id" UUID,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_excuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "offer_type" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "work_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_value_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "point_type" "PointType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_value_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "point_type" "PointType" NOT NULL,
    "entry_kind" TEXT NOT NULL,
    "direction" SMALLINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "point_value_version_id" UUID,
    "value_per_point_piasters" BIGINT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "reverses_entry_id" UUID,
    "reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_offset_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "green_entry_id" UUID NOT NULL,
    "penalty_entry_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_offset_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_work_calculations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "work_offer_id" UUID NOT NULL,
    "attendance_day_id" UUID NOT NULL,
    "eligible_minutes" INTEGER NOT NULL,
    "green_points_awarded" INTEGER NOT NULL,
    "salary" DECIMAL(14,2) NOT NULL,
    "monthly_hours_divisor" INTEGER NOT NULL,
    "pay_pounds" DECIMAL(14,2) NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "additional_work_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "reason" TEXT,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "actor_type" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by" UUID,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("company_id","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_owner_user_id_key" ON "companies"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_company_idx" ON "users"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_invitations_token_hash_key" ON "company_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "company_invitations_company_email_status_idx" ON "company_invitations"("company_id", "email", "status");

-- CreateIndex
CREATE INDEX "company_invitations_expires_at_idx" ON "company_invitations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_roles_role_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_one_role_per_user_key" ON "user_roles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_company_idx" ON "employees"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_employee_number_key" ON "employees"("company_id", "employee_number");

-- CreateIndex
CREATE INDEX "company_policy_versions_company_idx" ON "company_policy_versions"("company_id");

-- CreateIndex
CREATE INDEX "employee_compensation_employee_idx" ON "employee_compensation_versions"("company_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_compensation_employee_effective_from_key" ON "employee_compensation_versions"("employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "shifts_company_idx" ON "shifts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_company_name_key" ON "shifts"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_company_id_key" ON "shifts"("company_id", "id");

-- CreateIndex
CREATE INDEX "shift_versions_shift_idx" ON "shift_versions"("company_id", "shift_id");

-- CreateIndex
CREATE INDEX "shift_assignments_employee_idx" ON "shift_assignments"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "shift_assignments_shift_idx" ON "shift_assignments"("company_id", "shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_days_employee_id_work_date_key" ON "attendance_days"("company_id", "employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_excuses_attendance_day_id_key" ON "attendance_excuses"("attendance_day_id");

-- CreateIndex
CREATE INDEX "attendance_excuses_company_idx" ON "attendance_excuses"("company_id");

-- CreateIndex
CREATE INDEX "work_offers_employee_start_idx" ON "work_offers"("company_id", "employee_id", "starts_at");

-- CreateIndex
CREATE INDEX "point_value_versions_company_idx" ON "point_value_versions"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "point_value_versions_type_effective_from_key" ON "point_value_versions"("company_id", "point_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "point_ledger_entries_idempotency_key_key" ON "point_ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "point_ledger_employee_history_idx" ON "point_ledger_entries"("company_id", "employee_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "point_ledger_source_idx" ON "point_ledger_entries"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "point_offset_allocations_company_id_green_entry_id_idx" ON "point_offset_allocations"("company_id", "green_entry_id");

-- CreateIndex
CREATE INDEX "point_offset_allocations_company_id_penalty_entry_id_idx" ON "point_offset_allocations"("company_id", "penalty_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "point_offset_allocations_green_entry_id_penalty_entry_id_key" ON "point_offset_allocations"("green_entry_id", "penalty_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "additional_work_calculations_work_offer_id_key" ON "additional_work_calculations"("work_offer_id");

-- CreateIndex
CREATE INDEX "additional_work_attendance_idx" ON "additional_work_calculations"("company_id", "attendance_day_id");

-- CreateIndex
CREATE INDEX "audit_events_target_idx" ON "audit_events"("company_id", "target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_current_shift_id_fkey" FOREIGN KEY ("company_id", "current_shift_id") REFERENCES "shifts"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_policy_versions" ADD CONSTRAINT "company_policy_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_policy_versions" ADD CONSTRAINT "company_policy_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_compensation_versions" ADD CONSTRAINT "employee_compensation_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_compensation_versions" ADD CONSTRAINT "employee_compensation_versions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_compensation_versions" ADD CONSTRAINT "employee_compensation_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_versions" ADD CONSTRAINT "shift_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_versions" ADD CONSTRAINT "shift_versions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_versions" ADD CONSTRAINT "shift_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_version_weekdays" ADD CONSTRAINT "shift_version_weekdays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_version_weekdays" ADD CONSTRAINT "shift_version_weekdays_shift_version_id_fkey" FOREIGN KEY ("shift_version_id") REFERENCES "shift_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_shift_assignment_id_fkey" FOREIGN KEY ("shift_assignment_id") REFERENCES "shift_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_excuses" ADD CONSTRAINT "attendance_excuses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_excuses" ADD CONSTRAINT "attendance_excuses_attendance_day_id_fkey" FOREIGN KEY ("attendance_day_id") REFERENCES "attendance_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_excuses" ADD CONSTRAINT "attendance_excuses_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_excuses" ADD CONSTRAINT "attendance_excuses_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_offers" ADD CONSTRAINT "work_offers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_offers" ADD CONSTRAINT "work_offers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_offers" ADD CONSTRAINT "work_offers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_offers" ADD CONSTRAINT "work_offers_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_value_versions" ADD CONSTRAINT "point_value_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_value_versions" ADD CONSTRAINT "point_value_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_point_value_version_id_fkey" FOREIGN KEY ("point_value_version_id") REFERENCES "point_value_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "point_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_offset_allocations" ADD CONSTRAINT "point_offset_allocations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_offset_allocations" ADD CONSTRAINT "point_offset_allocations_green_entry_id_fkey" FOREIGN KEY ("green_entry_id") REFERENCES "point_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_offset_allocations" ADD CONSTRAINT "point_offset_allocations_penalty_entry_id_fkey" FOREIGN KEY ("penalty_entry_id") REFERENCES "point_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_work_calculations" ADD CONSTRAINT "additional_work_calculations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_work_calculations" ADD CONSTRAINT "additional_work_calculations_work_offer_id_fkey" FOREIGN KEY ("work_offer_id") REFERENCES "work_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_work_calculations" ADD CONSTRAINT "additional_work_calculations_attendance_day_id_fkey" FOREIGN KEY ("attendance_day_id") REFERENCES "attendance_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_work_calculations" ADD CONSTRAINT "additional_work_calculations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

