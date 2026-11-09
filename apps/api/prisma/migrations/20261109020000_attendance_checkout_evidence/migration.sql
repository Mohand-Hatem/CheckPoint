-- docs/05 §4.4 step 5: checkout evidence on the day (DN-08 left_early flag, no penalty; overtime units awarded).
ALTER TABLE "attendance_days"
  ADD COLUMN "left_early" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "overtime_greens" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "attendance_days_overtime_greens_check" CHECK ("overtime_greens" >= 0);
