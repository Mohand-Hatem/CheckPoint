-- Append-only guards for the audit log and the point ledger (docs/05 §13, AC-REQ-017-01, AC-REQ-028-01).
-- `prisma db push` cannot create triggers: apply with `npm run db:guards`, and re-run it after every db push.
-- Corrections are new rows (reversals); nothing may UPDATE, DELETE or TRUNCATE these tables.

CREATE OR REPLACE FUNCTION checkpoint_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION checkpoint_reject_mutation();

DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION checkpoint_reject_mutation();

DROP TRIGGER IF EXISTS point_ledger_entries_append_only ON point_ledger_entries;
CREATE TRIGGER point_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON point_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION checkpoint_reject_mutation();

DROP TRIGGER IF EXISTS point_ledger_entries_no_truncate ON point_ledger_entries;
CREATE TRIGGER point_ledger_entries_no_truncate
  BEFORE TRUNCATE ON point_ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION checkpoint_reject_mutation();
