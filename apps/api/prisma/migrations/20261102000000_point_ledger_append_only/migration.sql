-- One reversal per ledger entry (schema: point_ledger_entries.reverses_entry_id @unique).
CREATE UNIQUE INDEX "point_ledger_entries_reverses_entry_id_key" ON "point_ledger_entries"("reverses_entry_id");

-- The point ledger is append-only (spec AC-REQ-017-01): no UPDATE, DELETE or TRUNCATE, for anyone.
-- Corrections and reversals are new compensating rows, never edits.

CREATE FUNCTION "point_ledger_entries_block_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'point_ledger_entries is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "point_ledger_entries_no_update"
  BEFORE UPDATE ON "point_ledger_entries" FOR EACH ROW EXECUTE FUNCTION "point_ledger_entries_block_change"();
CREATE TRIGGER "point_ledger_entries_no_delete"
  BEFORE DELETE ON "point_ledger_entries" FOR EACH ROW EXECUTE FUNCTION "point_ledger_entries_block_change"();
CREATE TRIGGER "point_ledger_entries_no_truncate"
  BEFORE TRUNCATE ON "point_ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION "point_ledger_entries_block_change"();
