# Phase 4 completion: tasks

Tests: unit `npm test` (apps/api); e2e `npm run test:e2e` on the throwaway Docker PostgreSQL (port 55432), never Neon. Build `npm run build`, lint `npm run lint`. Each task: failing test first, shown red, then green.

## Task 1: Docs first (XS)
- [x] `08-DATABASE_SCHEMA.md`: `work_date` on `point_ledger_entries`; `payroll_months` PK `(company_id, month)`; `point_state` columns (quantities); month-lock triggers
- [x] `05-SYSTEM_DESIGN.md`: §5.2 state by quantity; §5.3 work_date + skip locked; §12 sweeper = candidate query + per-employee tx, same idempotency key as check-in; §14 lock first with `FOR NO KEY UPDATE`, READ COMMITTED
- [x] `09-DECISION_LOG.md`: C-22 … C-26
Verify: docs read consistently with `tasks/plan.md`. Depends on: none.

## Task 2: Lock first, READ COMMITTED (S)
- [x] `lockEmployee(tx, employeeId)` helper; called first in check-in record, checkout, admin add/reverse, correction; `saveAllocations` no longer locks (only its standalone path)
- [x] Remove `Serializable` from point add/reverse
- [x] e2e `test/point-concurrency.e2e-spec.ts`: 8 parallel admin adds for one employee. Red on old code (`40P01 deadlock detected` + write conflict), green after
- [x] Unit 282/282, e2e 16 suites / 121 tests (golden incl.), build, lint
Verify: e2e + golden cases pass. Depends on: 1. Files: `point-allocation.service.ts`, `points.service.ts`, `check.service.ts`, `attendance.service.ts`, new e2e.

## Task 3: `work_date` on the ledger (M)
- [x] Migration `20261119000000_point_work_date`: add column, backfill (attendance day date, else Cairo date of `created_at`, reversals copy their target), then `NOT NULL`; index `(company_id, employee_id, work_date)`. Append-only UPDATE trigger off only during the backfill
- [x] Every writer sets it (admin add = Cairo today, source award = `asOfDate`, reversals = target's date, correction); engine orders by `(work_date, created_at, id)`
- [x] e2e `test/point-work-date.e2e-spec.ts`: a RED with an older work date, written later, is cancelled first (red: no `workDate`; green after)
- [x] Backfill checked on 381 existing test rows: 0 nulls, 0 mismatches; triggers re-enabled; `migrate diff` no drift
- [x] Unit 282/282, e2e 17 suites / 122 tests, build, lint
Verify: migrate on Docker DB, no drift, all e2e pass. Depends on: 2.

## Task 4: Locked-month guard (M)
- [x] Migration `20261119010000_payroll_month_lock`: `payroll_months` (PK company+month, CHECKs), `month_status` enum, LOCKED row cannot change, insert triggers on `point_ledger_entries` and `point_offset_allocations` (both points' months) raising `MONTH_LOCKED`
- [x] `src/points/month-lock.ts`: engine skips locked-month points; admin add/reverse, source award/reversal and correction return `409 MONTH_LOCKED` (after the idempotent-replay check)
- [x] e2e `test/month-lock.e2e-spec.ts` (red: table missing; green after): locked-month GREEN not used; 409 on award/reversal; raw ledger insert and offset insert fail at DB level. Check-in suites still pass
- [x] Unit 282/282, e2e 18 suites / 125 tests, build, lint, `migrate diff` no drift
Verify: DoD item "locked month fails at DB level". Depends on: 3.

## Task 5: `point_state` view (S)
- [x] Migration `20261119020000_point_state_view`: one row per AWARD with `quantity, reversed, month_locked, consumed_qty, cancelled_qty, available_qty, settled_qty, active_qty` (+ `source_id`, `reason` for reads); not a Prisma model
- [x] e2e `test/point-state.e2e-spec.ts` (red: relation missing; green after): every state incl. settled (locked month) and reversed; engine agreement (no open GREEN left while a RED is active). Used an explicit scenario instead of G4
- [x] Unit 282/282, e2e 19 suites / 127 tests, build, lint, no drift
Depends on: 4.

## Task 6: Employee point queries (M)
- [x] `GET /me/points?month=&type=&page=&limit=` and `GET /me/points/summary?month=` (`MyPointsController`, `MyPointsService` on `point_state`); own company and own employee only; Swagger decorators, `docs/api/openapi.json`, guide steps in `scripts/build-api-guide.ts` → `docs/10-API_TESTING_GUIDE.md` (73 steps passed)
- [x] e2e `test/my-points.e2e-spec.ts` (red: 404; green after): own data only, other employee hidden, newest work date first with states, type filter, paging, default month, summary, 400/401
- [x] Unit 282/282, e2e 20 suites / 132 tests, build, lint
Depends on: 5.

## Checkpoint A
- [x] Unit + e2e + golden pass, build and lint clean
- [x] Review with Mohand (he chose to continue to Task 7)

## Task 7: Shared day-schedule helper (S)
- [x] `scheduleForDay(employee, workDate)` (pure, `attendance-rules.ts`): shift version in force + current-shift assignment; check-in uses it. Working day stays `CalendarService.isWorkingDay`, windows stay `computeWindows`; the sweeper calls the same three with the same `employees.findOne` record
- [x] Behaviour unchanged: check-in unit + e2e untouched and green; 2 new unit tests for the helper (written after the move: a pure refactor, the existing suites are the guard)
- [x] Unit 284/284, e2e 20 suites / 132 tests, build, lint
- Note: admin correction (`AttendanceService.scheduleFor`) judges a day differently (needs an assignment, uses shift-version weekdays, ignores holidays). Left as is; open question in `plan.md`
Verify: existing check-in unit + e2e pass untouched. Depends on: A.

## Task 8: `AbsenceSweepService` (M)
- [x] `src/attendance/absence-sweep.service.ts` `run(now)`: expires PENDING verifications past `expires_at`; per company (timezone, `absence_lookback_days`) a set-based candidate query, then per candidate its own tx: `lockEmployee`, re-check live verification, ABSENT row (`createMany skipDuplicates` = ON CONFLICT DO NOTHING), BLACK with key `ATT:{employeeId}:{date}`, audit `attendance.absent` (SYSTEM), offset engine. One failing employee/company is logged and counted, the rest continue. Returns `{ expired, absences, failed }`
- [x] Skips: before `active_from`, deactivated before the day, no shift, non-working day (weekly off, holiday; an off-day-work exception gives no BLACK), live PENDING verification, locked month, before the red-period end today. Leave: Phase 5
- [x] e2e `test/absence-sweep.e2e-spec.ts` (red: no service; green after): every skip rule, offsets in the same tx, expired verification, 10 re-runs add no rows (DoD)
- [x] `MyAttendanceDayDto` documents `ABSENT`; openapi regenerated
- [x] Unit 284/284, e2e 21 suites / 136 tests, build, lint
Depends on: 7.

## Task 9: BullMQ wiring (S)
- [x] Added `bullmq` + `ioredis` (not `@nestjs/bullmq`: v12 is ESM-only and breaks jest; plain bullmq is ~40 lines). `REDIS_PORT` checked in `validateEnv`; `AbsenceSweepQueueModule` loaded with `ConditionalModule.registerWhen` only when `REDIS_HOST` is set and not under jest; `upsertJobScheduler` every 60 s, worker concurrency 1, calls `AbsenceSweepService.run`; boot warning when off
- [x] Verified by running `dist/main.js`: without Redis it boots and warns; with a throwaway Redis, 3 jobs in 140 s (first caught up 408 absences on old test data, next ones 0), 0 failed
- [x] Unit tests for the queue; unit 286/286, e2e 21 suites / 136 tests (no Redis touched), build, lint; `npm audit` unchanged (10 existing, none new)
Depends on: 8.

## Task 10: Late check-in closed (S)
- [x] Check-in at or after `redPeriodEndAt` ⇒ `422 ATTENDANCE_CLOSED` at step 1 and at confirm (`planCheckIn`); off-day-work days and admin corrections unchanged (PRD §6 already says no check-in from 12:00, so no spec change)
- [x] Unit: BLACK confirm row replaced by two ATTENDANCE_CLOSED tests (red first, then green); 05 §4.2 note and check-in Swagger text updated; openapi regenerated
- [x] Fix found on the way (Task 9): `docs:openapi` hung because the sweeper awaited Redis in `onApplicationBootstrap`. Now scheduling is not awaited (a Redis outage pauses only the sweeper; verified: API serves with Redis unreachable, and with Redis up 2 jobs in 80 s), and the OpenAPI builder clears `REDIS_HOST`
- [x] Unit 287/287, e2e 21 suites / 136 tests, build, lint
Depends on: 8.

## Task 11: Concurrency tests (S)
- [x] Parallel sweeps ⇒ one BLACK per day (`absence-sweep.e2e-spec.ts`); five racing reversals ⇒ one row, only clean 409s; check-in confirm + 3 parallel admin adds ⇒ all succeed, one attendance day, the RED paid once (`point-concurrency.e2e-spec.ts`)
- [x] Mutation check: with `lockEmployee` turned into a no-op, the parallel-adds and confirm tests fail (2 runs); restored. The reversal test holds without the lock (unique `reverses_entry_id`)
- [x] Unit 287/287, e2e 21 suites / 139 tests, build, lint
Depends on: 8–10.

## Checkpoint B (Phase 4 DoD)
- [x] Sweep 10× creates no extra rows
- [x] Locked-month insert fails at DB level
- [x] All tests, build, lint; `graphify update .`; tick `06-ROADMAP.md`
- [ ] Mohand: apply new migrations to Neon

## Task 12: Git (ask before each)
- [x] `git switch -c phase-4-completed`
- [ ] one commit
- [ ] push
- [ ] PR to main
- [ ] merge

## Task 13: HAS-168 employee attendance excuses (added to this branch, 2026-11-19)
- [x] Spec v0.6.0 / CHG-007: REQ-034 (AC-01..05 confirmed, AC-06/07 proposals), DEC-029, GAP-030 (Admin review). Approved by Mohand in chat, recorded in `SPEC_APPROVAL.md` at his instruction
- [x] Docs: 02 E12, FR-ATT-8, DN-26 closed; 05 §2.2 + §4.8; 08 `attendance_excuses`; 09 D-22, C-19 closed, REQ-034 traceability; 06 Phase 5 note
- [x] Code: `EmployeeAttendanceExcuseService` + 3 routes on `MyAttendanceController` (`POST /me/attendance/:attendanceDayId/excuse`, `GET /me/attendance-excuses`, `GET /me/attendance-excuses/:id`); audit `attendance_excuse.submit`; no migration (unique `attendance_day_id` gives the 409)
- [x] e2e `test/my-attendance-excuses.e2e-spec.ts` (red: 404 routes; green after): AC-01..06, same 404 for other employee / other company / missing, 409 incl. race, own-only list and get, 401
- [x] Swagger, openapi.json (66 operations), guide 77 steps; unit 287/287, e2e 22 suites / 145 tests, build, lint
- [x] Committed (40a05db) and pushed on phase-4-completed

## Task 14: HAS-170 Admin excuse decision (branch `phase-5`, from phase-4-completed at 40a05db)
- [x] Spec v0.7.0 / CHG-008: REQ-035 (AC-01..07 incl. self-decision block), DEC-030, GAP-030 narrowed to notification, GAP-031 (Admin excuse list). Approved by Mohand in chat, recorded in `SPEC_APPROVAL.md` at his instruction
- [x] Docs: 02 A12, FR-ATT-9; 05 §2.3, §4.8, §14 row; 08 CHECKs; 09 D-23 + REQ-035 traceability; 06 Phase 5 note
- [x] Migration `20261119030000_attendance_excuse_checks`: status IN (PENDING, APPROVED, REJECTED); decision fields set exactly when not PENDING
- [x] Code: `AdminAttendanceExcuseDecisionService`, `POST /admin/attendance-excuses/:id/decision` (`attendance.write`, 200): conditional UPDATE WHERE status = PENDING, 409 `EXCUSE_ALREADY_DECIDED`, 403 `SELF_DECISION_FORBIDDEN`, 404, audit `attendance_excuse.decide`; no attendance or ledger write
- [x] e2e `test/admin-excuse-decision.e2e-spec.ts` (red: route missing; green after): AC-01..07, race (one 200, one 409, one audit row), employee sees the decision, DB CHECKs
- [x] Swagger, openapi.json (67 operations), guide 80 steps; unit 287/287, e2e 23 suites / 153 tests, build, lint
- [ ] Commit, push, PR phase-5 → main (ask each)
