-- Admin excuse decision (REQ-035, 08 attendance_excuses, D-23): keep status and decision fields consistent.
ALTER TABLE "attendance_excuses"
  ADD CONSTRAINT "attendance_excuses_status_check"
  CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));

-- PENDING has no decision; APPROVED / REJECTED always have who, when and why.
ALTER TABLE "attendance_excuses"
  ADD CONSTRAINT "attendance_excuses_decision_check"
  CHECK (
    ("status" = 'PENDING' AND "decided_by_user_id" IS NULL AND "decided_at" IS NULL AND "decision_reason" IS NULL)
    OR ("status" <> 'PENDING' AND "decided_by_user_id" IS NOT NULL AND "decided_at" IS NOT NULL AND "decision_reason" IS NOT NULL)
  );
