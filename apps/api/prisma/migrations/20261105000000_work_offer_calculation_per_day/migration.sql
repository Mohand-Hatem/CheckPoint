-- A work offer can cover many employees and days: one calculation per attendance day, not per offer.
DROP INDEX "additional_work_calculations_work_offer_id_key";

CREATE UNIQUE INDEX "additional_work_calculations_offer_day_key"
  ON "additional_work_calculations"("work_offer_id", "attendance_day_id");
