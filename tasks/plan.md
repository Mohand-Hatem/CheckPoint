# Implementation Plan: finish Phase 4 (Points + Offset Engine)

Branch: work stays uncommitted on `feat/pointAllocation` (same code as `origin/main` after PR #18). At the end: new branch `phase-4-completed`, one commit, push, PR, merge. Each git step needs Mohand's yes.
Previous plan (offset engine, merged in PR #18): `tasks/plan-offset-engine-done.md`.

## Overview
Phase 4 is done for the ledger and the offset engine. Still open: absence sweeper, `point_state` view, locked-month guard, employee point queries and concurrency tests. Review of the current code found three problems that block or break these items. They are fixed first (Tasks 1–3).

## Review findings (current code)
| # | Finding | Where | Impact |
|---|---|---|---|
| F1 | The employee lock (`SELECT … FOR UPDATE`) is taken **after** the transaction already inserted rows that reference the employee. Each FK insert holds `FOR KEY SHARE` on the employee row, and `FOR UPDATE` conflicts with it. Two point writes for the same employee at once (checkout + admin add, or the sweeper) can deadlock, and Postgres kills one with a 500. | `point-allocation.service.ts:190` | High: shows up as soon as the sweeper runs |
| F2 | Admin add/reverse use `Serializable` with no retry. The snapshot is taken before the lock, so a parallel check-in for the same employee fails with `40001`, which becomes a 500. Check-in and checkout use READ COMMITTED. | `points.service.ts:268, 563` | Medium |
| F3 | `point_ledger_entries` has no `work_date`. The design orders offsets by `(work_date, created_at, id)` and decides month lock and `?month=` by the point's month. Today the engine sorts by `created_at`, so a Black the sweeper writes today for a day 3 days ago sorts as "new". | schema, `point-allocation.service.ts:131` | High: blocks the month guard, month filter and correct ordering |
| F4 | The engine loads every unreversed point the employee ever had. Once a month is locked it would spend Greens already settled to the Fund, and the trigger would then fail the check-in. | `preparePoints` | High after Phase 6, fixed with the month guard |
| F5 | `payroll_months` in `08-DATABASE_SCHEMA.md` has PK `month` only, with no `company_id`. That breaks the multi-company rule (REQ-NFR-008). | docs | Medium: doc fix before the migration |
| F6 | The `point_state` design gives one state per point, but one row can carry N points (overtime Greens, admin quantity) and can be partly consumed. The view must return quantities per row, not one label. | docs §5.2 | Medium: doc fix |
| F7 | A check-in after the red period records a BLACK attendance. The agreed rule is: once the sweeper exists, return `422 ATTENDANCE_CLOSED`. | `attendance-rules.ts`, check-in | Small |
| — | Attendance correction writes ledger rows directly instead of using `PointsService`; error is logged and rethrown in `saveAllocations`. | — | Low, out of scope, left alone |

## Architecture decisions (recommended)
- **Locking:** every transaction that writes points takes the employee lock **first**, through one helper `lockEmployee(tx, employeeId)` (`SELECT … FOR NO KEY UPDATE`). It runs at READ COMMITTED, the Postgres default. Drop `Serializable` on point add/reverse. This matches design §14 ("user lock held" before the engine). Idempotency already comes from unique keys, not isolation.
- **`work_date` on the ledger:** a `date NOT NULL` column. Attendance, overtime and early-checkout points use the attendance day's date. Admin points and the sweeper use the Cairo date they apply to. Existing rows are backfilled from their attendance day, or else from the Cairo date of `created_at`. Month = `date_trunc('month', work_date)`.
- **Month lock now, payroll later:** stub table `payroll_months(company_id, month, status, locked_at, locked_by)`, PK `(company_id, month)`. Triggers reject a ledger or offset insert whose month is `LOCKED`. The engine skips locked-month points. Services return `409 MONTH_LOCKED` before the trigger fires. Nothing locks a month until Phase 6; tests insert a LOCKED row directly.
- **`point_state` view:** one row per AWARD with `quantity`, `reversed`, `consumed_qty` (Green), `cancelled_qty` (Red/Black, in units), `available_qty` / `active_qty`, `month_locked`. Reads (employee and admin) use it. The engine keeps its tested TypeScript logic. One e2e test checks the view and the engine agree.
- **Sweeper = plain service + thin BullMQ wrapper.** `AbsenceSweepService.run(now)` holds all the logic and is tested directly against the DB, with no Redis in tests. A BullMQ job scheduler (`upsertJobScheduler`, every 60 s, worker concurrency 1) calls it. The queue module loads only when `REDIS_HOST` is set, so e2e and local runs without Redis still boot. BullMQ is already the decided tool (`03-TECH_STACK.md`).
- **Sweeper is set-based, then per employee.** One SQL query finds candidates: active employee, no attendance row for the day, no live PENDING verification, month open, days from `max(today − absence_lookback_days, first open month)` to today. Then for each candidate, in its own short transaction: `lockEmployee`, re-check, check working day and `now ≥ late_end`, insert `ABSENT` attendance `ON CONFLICT DO NOTHING`, award BLACK with the **same idempotency key as check-in** (`ATT:{employeeId}:{date}`), run the engine. Running it twice or in parallel does nothing extra.
- **One schedule helper.** The shift-window, working-day and assignment code inside `CheckService.planCheckIn` moves to a shared helper, so check-in and the sweeper cannot disagree about a day.

## Task list (details in `tasks/todo.md`)
1. Docs first: F3, F5, F6, the sweeper details, the lock rule (XS)
2. Lock first, READ COMMITTED (F1, F2), deadlock test red then green (S)
3. `work_date` on the ledger + backfill + engine ordering (M)
4. `payroll_months` stub + locked-month triggers + engine skips locked months (M)
5. `point_state` view (S)
6. `GET /me/points`, `GET /me/points/summary` (M)
— Checkpoint A
7. Extract the shared day-schedule helper from check-in (S)
8. `AbsenceSweepService` + verification expiry (M)
9. BullMQ wiring, conditional on `REDIS_HOST` (S)
10. Check-in after the red period ⇒ `ATTENDANCE_CLOSED` (F7) (S)
11. Concurrency tests (S)
— Checkpoint B, then Definition of Done, `graphify update .`, roadmap ticks
12. Git (each step asked): branch `phase-4-completed`, commit, push, PR, merge

Out of scope: web/mobile point screens (frontend track), notifications (Phase 5), Month Close (Phase 6).

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Backfill of `work_date` on Neon | Med | Pure SQL in the migration, tested on the throwaway Docker DB first; Neon migrated by Mohand later |
| Sweeper load (companies × employees × 7 days every minute) | Med | Set-based candidate query; per-employee transaction only for real candidates; index check with `EXPLAIN` |
| Sweeper and check-in disagree about a day | High | One shared schedule helper (Task 7) + same idempotency key |
| Redis missing in prod | Med | Queue loads only with `REDIS_HOST`; health log at boot says the sweeper is off |
| Phase 6: a GREEN in an open month paid a RED in a month that later locks; reversing that GREEN needs an UNDO row touching the locked month, which the trigger refuses (`MONTH_LOCKED`) | Med (Phase 6) | Safe failure today; Month Close must decide (e.g. no cross-month offsets, or freeze such pairs) |
| Changing the lock path breaks golden cases | Med | Golden + offset e2e suites run after Task 2 and at each checkpoint |

## Open questions
- Admin correction decides "working day" differently from check-in and the sweeper: it needs a shift assignment and uses the shift version's weekdays, ignoring holidays and the company's weekly off days; check-in uses the current shift and the company calendar. Make correction use `scheduleForDay` + `CalendarService` too? (Changes correction behaviour, so not done in Phase 4 without a yes.)
- Absence sweep for a past day uses the employee's *current* shift (same as check-in). If the shift changed inside the lookback window, the old day is judged by the new shift. Acceptable for 7 days, or look up the shift assigned on that day?
- Where does Redis run in production (Neon is the DB)? Not blocking: the code ships with the sweeper off until `REDIS_HOST` is set.
- Admin-added point `work_date`: default the Cairo date of the add (recommended), or let the admin pick a past open-month date?
