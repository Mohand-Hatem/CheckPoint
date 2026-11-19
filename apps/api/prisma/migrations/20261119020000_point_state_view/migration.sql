-- Derived point state (05 §5.2, 08 point_state, C-24): one row per AWARD entry, with quantities,
-- because one entry can carry N points and be partly used. Read-only; nothing is ever updated.
-- BLACK ratio 5 matches the offset engine (PointAllocationService RATIO.BLACK).
CREATE VIEW "point_state" AS
WITH active_offsets AS (
  SELECT a."green_entry_id", a."penalty_entry_id", a."quantity"
  FROM "point_offset_allocations" a
  WHERE a."reverses_allocation_id" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "point_offset_allocations" u WHERE u."reverses_allocation_id" = a."id")
),
base AS (
  SELECT
    e."id" AS entry_id,
    e."company_id",
    e."employee_id",
    e."point_type",
    e."work_date",
    date_trunc('month', e."work_date")::date AS payroll_month,
    e."quantity",
    e."source_type",
    e."source_id",
    e."reason",
    e."created_at",
    EXISTS (SELECT 1 FROM "point_ledger_entries" r WHERE r."reverses_entry_id" = e."id") AS reversed,
    EXISTS (
      SELECT 1 FROM "payroll_months" m
      WHERE m."company_id" = e."company_id"
        AND m."month" = date_trunc('month', e."work_date")::date
        AND m."status" = 'LOCKED'
    ) AS month_locked,
    COALESCE((SELECT SUM(o."quantity") FROM active_offsets o WHERE o."green_entry_id" = e."id"), 0)::int AS greens_given,
    COALESCE((SELECT SUM(o."quantity") FROM active_offsets o WHERE o."penalty_entry_id" = e."id"), 0)::int AS greens_received
  FROM "point_ledger_entries" e
  WHERE e."entry_kind" = 'AWARD'
)
SELECT
  entry_id, company_id, employee_id, point_type, work_date, payroll_month, quantity,
  source_type, source_id, reason, created_at, reversed, month_locked,
  CASE WHEN NOT reversed AND point_type = 'GREEN' THEN greens_given ELSE 0 END AS consumed_qty,
  CASE WHEN reversed THEN 0
       WHEN point_type = 'RED' THEN greens_received
       WHEN point_type = 'BLACK' THEN greens_received / 5
       ELSE 0 END AS cancelled_qty,
  CASE WHEN NOT reversed AND point_type = 'GREEN' AND NOT month_locked THEN quantity - greens_given ELSE 0 END AS available_qty,
  CASE WHEN NOT reversed AND point_type = 'GREEN' AND month_locked THEN quantity - greens_given ELSE 0 END AS settled_qty,
  CASE WHEN reversed THEN 0
       WHEN point_type = 'RED' THEN quantity - greens_received
       WHEN point_type = 'BLACK' THEN quantity - greens_received / 5
       ELSE 0 END AS active_qty
FROM base;
