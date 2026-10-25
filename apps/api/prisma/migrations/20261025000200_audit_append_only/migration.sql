-- The audit log is append-only (spec REQ-028, docs/08 invariant I20): no UPDATE, DELETE or TRUNCATE, for anyone.
-- Corrections are new events, never edits.

CREATE FUNCTION "audit_events_block_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_no_update"
  BEFORE UPDATE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "audit_events_block_change"();
CREATE TRIGGER "audit_events_no_delete"
  BEFORE DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "audit_events_block_change"();
CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit_events" FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_block_change"();
