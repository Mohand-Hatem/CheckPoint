# Plan: fix the point allocation (offset) branch

## Overview
Commit `0a8ece0` runs offset matching as a BullMQ job after check-in. The design (`05-SYSTEM_DESIGN.md` §5.3, §14) runs it inside the same DB transaction as the point change. This plan moves it back into the transaction, runs it after every point change, and keeps BullMQ only for scheduled work (absence sweeper).

## Decisions
- Offsets run synchronously inside the caller's transaction, under the user lock. They are a few DB rows, need the same lock, and must commit or roll back together with the point. No Redis on the check-in path.
- If the transaction fails, everything rolls back and the API returns an error; the employee scans again. Nothing is half-saved, so there is nothing to retry and nothing for an admin to fix.
- BullMQ stays for scheduled/external work only: absence sweeper, verification expiry, later payouts and notifications (via outbox).
- Offset rows stay append-only (APPLY / UNDO), no `upsert ... increment`.

## Tasks

### Task 1: Dependencies and env names (XS)
- Add `bullmq` and `@nestjs/bullmq` to `apps/api/package.json` (still needed for the sweeper).
- `app.module.ts` reads `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (the names in `.env` / `.env.example`); add them to `validateEnv`.
- Revert the quote-style reformat in `app.module.ts`.
- Verify: `npm run build` and the existing test suite pass.

### Task 2: Offset engine runs inside the check-in transaction (S)
- `OffsetEngine.run(tx, companyId, employeeId)` takes the caller's `tx`; it does not open its own transaction or take its own lock.
- `recordCheckIn` calls it after awarding the point, before commit. Remove `pointAllocationQueue.add` from `check.service.ts`.
- Verify: integration test: confirm with an open Red and one Green leaves the Red cancelled in the same response; DB failure mid-run leaves no attendance and no point.
- Depends on: Task 1.

### Task 3: Run after every point change (S)
- Call the engine after checkout overtime Greens, admin add, and admin reverse.
- Verify: overtime Green at checkout cancels an open Red immediately; admin Green does the same.
- Depends on: Task 2.

### Task 4: Reversal undoes offsets (M, needs a migration)
- Offset rows become append-only APPLY/UNDO rows with a `group_id` (§5.3, `08-DATABASE_SCHEMA.md`). A Black's 5 Greens share one group.
- Reversing a point that is in an active offset inserts UNDO rows for the whole group, then reruns the engine.
- Verify: unit + integration: reverse a consumed Green → its Red becomes active again (or is re-matched with another Green); reverse a cancelled Red → its Green is freed; `UPDATE`/`DELETE` on offset rows fails.
- Depends on: Task 2.

### Task 5: Cleanup (XS)
- Rename `pointAlocation/` to `point-offsets/` (or fold into `points/`), `proccessor` typo; remove the processor if nothing queues `allocate-points` any more.
- Run `graphify update .`.

### Checkpoint
- [x] All tests pass, build clean
- [x] Golden cases G1–G5, G7 (`05-SYSTEM_DESIGN.md` §15.4) pass for points
- [ ] Review with Mohand before the single final commit

## Separate business change (Phase 5, spec first)
Decided 2026-11-17: early checkout without an approved early leave (none, rejected or cancelled) adds one separate RED, any minute early, day's check-in point kept. Spec v0.5.0 draft written (CHG-006, AC-REQ-013-04, AC-REQ-022-03, DEC-028).
- [x] Mohand approves v0.5.0 in `planning/docs/planning/SPEC_APPROVAL.md`
- [x] Docs: `02-PRD.md` (line 251, DN-08, edge case #11), `05-SYSTEM_DESIGN.md` §4.4 step 5 and §7, `08-DATABASE_SCHEMA.md` `left_early` note + point source, `09-DECISION_LOG.md`
- [x] Code: `check.service.ts` checkout awards the RED (dedupe key per attendance day) in the checkout transaction, then runs offsets (needs Task 3); attendance correction recomputes it
- [x] Tests: 1 min early → RED; at shift end → none; retry → refused (ALREADY_CHECKED_OUT), still one RED. Approved/rejected early leave → Phase 5 when requests exist

## Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Offset run slows check-in | Low | Per-employee query, a handful of rows; index on `(employee_id, point_type)` |
| Migration for APPLY/UNDO on shared Neon DB | Med | Run e2e only on throwaway Docker DB; baseline Neon first |

## Status 2026-11-17 (on top of Ali's 08cf388, uncommitted)
- [x] Task 1: BullMQ wiring removed (nothing queues work now); `app.module.ts` restored from main, so the env-name problem is gone. Add `bullmq` + `REDIS_*` with the absence sweeper.
- [x] Task 2: offsets inside the check-in transaction (Ali, 08cf388)
- [x] Task 3: offsets after checkout, admin add, admin reverse, attendance correction
- [x] Task 4: append-only APPLY/UNDO rows (`reverses_allocation_id`), migration `20261117000000_point_offset_undo`
- [x] Task 5: moved to `src/points/point-allocation.service.ts`; quote noise reverted in `points.service.ts`
- [x] D-21 early-checkout RED at checkout and on correction
- [x] Unit tests 282/282, build, lint clean
- [x] Migration + e2e on a throwaway Docker DB: 11 migrations, no schema drift, 14 suites / 110 tests pass incl. new `test/point-offsets.e2e-spec.ts`
- [x] Golden cases G1–G5, G7 (+ G8) as integration tests: `test/golden-cases.e2e-spec.ts`, 10/10 pass
- [ ] Review with Mohand, then one final commit
