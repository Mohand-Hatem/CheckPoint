-- CreateTable
CREATE TABLE "employee_salary_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "base_salary" DECIMAL(14,2) NOT NULL,
    "leave_deduction" DECIMAL(14,2) NOT NULL,
    "applied_red_deduction" DECIMAL(14,2) NOT NULL,
    "applied_black_deduction" DECIMAL(14,2) NOT NULL,
    "off_day_pay" DECIMAL(14,2) NOT NULL,
    "fund_credit" DECIMAL(14,2) NOT NULL,
    "net_salary" DECIMAL(14,2) NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_salary_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_salary_records_company_id_month_idx" ON "employee_salary_records"("company_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salary_records_employee_month_key" ON "employee_salary_records"("company_id", "employee_id", "month");

-- AddForeignKey
ALTER TABLE "employee_salary_records" ADD CONSTRAINT "employee_salary_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary_records" ADD CONSTRAINT "employee_salary_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
