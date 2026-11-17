-- Offsets become append-only (05 §5.3, closes U-5): a reversal never edits an offset row;
-- an UNDO row points at the APPLY row it cancels, and the same Green/penalty pair may be re-applied later.
DROP INDEX "point_offset_allocations_green_entry_id_penalty_entry_id_key";

ALTER TABLE "point_offset_allocations" ADD COLUMN "reverses_allocation_id" UUID;
CREATE UNIQUE INDEX "point_offset_allocations_reverses_allocation_id_key" ON "point_offset_allocations"("reverses_allocation_id");
ALTER TABLE "point_offset_allocations" ADD CONSTRAINT "point_offset_allocations_reverses_allocation_id_fkey" FOREIGN KEY ("reverses_allocation_id") REFERENCES "point_offset_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "point_offset_allocations" ADD CONSTRAINT "point_offset_allocations_quantity_positive" CHECK ("quantity" > 0);

CREATE FUNCTION "point_offset_allocations_block_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'point_offset_allocations is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "point_offset_allocations_no_update"
  BEFORE UPDATE ON "point_offset_allocations" FOR EACH ROW EXECUTE FUNCTION "point_offset_allocations_block_change"();
CREATE TRIGGER "point_offset_allocations_no_delete"
  BEFORE DELETE ON "point_offset_allocations" FOR EACH ROW EXECUTE FUNCTION "point_offset_allocations_block_change"();
CREATE TRIGGER "point_offset_allocations_no_truncate"
  BEFORE TRUNCATE ON "point_offset_allocations" FOR EACH STATEMENT EXECUTE FUNCTION "point_offset_allocations_block_change"();
