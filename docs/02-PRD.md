# 02 — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| **Version** | 3.0 |
| **Status** | Final draft — implementation-ready; open items marked `DECISION NEEDED (DN-xx)` |
| **Last Updated** | 2026-10-08 |
| **Source of Truth** | The finalization prompt ("**SoT**", section numbers cited as §n) overrides every older document. Where the SoT is silent, this PRD states the **provisional default** and tags it `DECISION NEEDED`. No other new rules are introduced. |

**Priority labels:** `MVP` (build now) · `Later` (planned, not now) · `Future` (design must not block it) · `Out of Scope`.

---

## 1. Actors

| Actor | Active role code | Notes |
|---|---|---|
| Employee | `EMPLOYEE` | Sees/changes only own data. |
| Admin | `ADMIN` | Broad authority; all mutations audited. |
| System | — | Background jobs act as `SYSTEM` (actor null, `actor_type='SYSTEM'`). |
| Paymob | — | External provider. |

Only `ADMIN` and `EMPLOYEE` exist in the current version. `MANAGER`, `HR`, `FINANCE` are **Future** (§16); the RBAC foundation must allow adding them without code restructuring.

## 2. Policy Constants (defaults — SoT)

| Item | Value | Where configured |
|---|---|---|
| Work start / end (default schedule) | 08:00 / 16:00 | `work_schedules` |
| EARLY window | start → start+60 min (08:00–08:59) | `work_schedules.early_minutes=60` |
| NORMAL window | next 60 min (09:00–09:59) | `normal_minutes=60` |
| LATE window | next 120 min (10:00–11:59) | `late_minutes=120` |
| ABSENT | from start+240 min (12:00+) | derived |
| RED value | **250 EGP** | `point_values` |
| BLACK value | **1000 EGP** | `point_values` |
| GREEN value | **1 USD** (unused, at settlement) | `point_values` |
| Offset ratios | 1 Green : 1 Red · 5 Green : 1 Black | `settings` (defaults) |
| QR verification window | **15 minutes** | `settings.qr_verification_window_minutes` |
| QR token rotation | 30 s (token valid for current + previous slot ≈ ≤60 s) | `settings.qr_rotation_seconds` |
| Overtime unit | 60 min | `settings.overtime_unit_minutes` |
| Timezone | `Africa/Cairo` business time, UTC storage | fixed |
| USD→EGP rate | **none assumed**; supplied and frozen at Month Close | `payroll_months.usd_egp_rate` |

Windows use **half-open intervals** `[from, to)`: 09:00:00 is NORMAL, 10:00:00 is RED, 12:00:00 is ABSENT.

## 3. User Stories

### Employee
| ID | Story | Priority |
|---|---|---|
| E1 | Log in and stay signed in securely (access + refresh tokens). | MVP |
| E2 | Check in: server validates GPS/geofence/accuracy, then I scan the company QR within 15 minutes; attendance is confirmed only after QR success. | MVP |
| E3 | Receive exactly one attendance point for the day (GREEN/WHITE/RED/BLACK) according to check-in time. | MVP |
| E4 | Check out; receive overtime Greens = floor(minutes after shift end / 60). | MVP |
| E5 | See my Greens being used to cancel Reds/Blacks, with which point cancelled which. | MVP |
| E6 | Request leave (ANNUAL/SICK/UNPAID) and see its status. | MVP |
| E7 | Request early leave for a day with requested checkout time and reason. | MVP |
| E8 | View attendance history, point history and the monetary impact (potential deductions, projected Fund). | MVP |
| E9 | See fund balance and history; withdraw to my payout method; see payout status. | MVP |
| E10 | Manage my payout method. | MVP |
| E11 | Request to work on an off day. | Later (MVP: admin grants exception) |

### Admin
| ID | Story | Priority |
|---|---|---|
| A1 | Create/update/disable/reactivate employees; set salary (versioned). | MVP |
| A2 | Manage schedules, assign them with `effectiveFrom/effectiveTo`, modify future schedules. | MVP |
| A3 | Manage locations, employee↔location assignment, QR display for a location. | MVP |
| A4 | Manage holidays, weekly off days, off-day-work exceptions. | MVP |
| A5 | View attendance; manual check-in / check-out / correction. | MVP |
| A6 | Add Green/White/Red/Black points; void/reverse points; view complete history. | MVP |
| A7 | Approve / reject / cancel-approval of leave; approve / reject early leave. | MVP |
| A8 | Preview payroll, close/lock month, add payroll adjustments. | MVP |
| A9 | Review fund, perform fund adjustments (ledger entries), review/inquire/manual-resolve payouts. | MVP |
| A10 | Edit settings (policy toggles, limits, weekly off days). | MVP |
| A11 | Review audit log. | MVP |

### System
| ID | Story | Priority |
|---|---|---|
| S1 | After the absence threshold, create exactly one BLACK for eligible employees; reruns create nothing. | MVP |
| S2 | Expire QR verifications after 15 minutes. | MVP |
| S3 | At Month Close, compute payroll, convert unused Greens to Fund credit, and lock the month. | MVP |
| S4 | Send payouts to Paymob, track to final state, never treat a timeout as failure. | MVP |

## 4. Functional Requirements

### 4.1 Authentication & Authorization
| ID | Requirement | Priority |
|---|---|---|
| FR-AUTH-1 | Login with email+password (argon2id); short-lived JWT access token; rotating refresh token with reuse detection; logout revokes. | MVP |
| FR-AUTH-2 | Login throttling per email+IP. | MVP |
| FR-AUTH-3 | Permission-based guards over roles; seeded roles `ADMIN`, `EMPLOYEE` only. | MVP |
| FR-AUTH-4 | Employees can only access their own resources (ownership check). | MVP |
| FR-AUTH-5 | Admin-driven password reset. Self-service reset by email/SMS. | MVP / Later |
| FR-AUTH-6 | `MANAGER`, `HR`, `FINANCE`. | Future |

### 4.2 Employees, Schedules, Calendar, Locations
| ID | Requirement | Priority |
|---|---|---|
| FR-EMP-1 | CRUD, disable/reactivate; disabled users cannot log in or refresh. | MVP |
| FR-EMP-2 | Salary stored as versioned rows (`effective_from`). | MVP |
| FR-SCH-1 | `WorkSchedule` (start, end, window minutes) + `ScheduleAssignment` (`effectiveFrom`, `effectiveTo`); no overlapping assignments per employee. | MVP |
| FR-SCH-2 | Rotating shifts, split shifts, advanced rules. | Out of Scope |
| FR-CAL-1 | Weekly off days (setting) and holidays (table). A date is a **working day** iff it is not a weekly off day and not a holiday. | MVP |
| FR-CAL-2 | Off-day-work exception granted by admin for (employee, date). | MVP |
| FR-LOC-1 | Location = lat/lng/radius; many-to-many with employees; per-location QR secret. | MVP |

### 4.3 Attendance
| ID | Requirement | Priority |
|---|---|---|
| FR-ATT-1 | Check-in step 1: authenticated, working day (or granted exception), no approved full-day leave, no confirmed attendance, GPS accuracy ≤ threshold, inside **any** assigned location's radius, within the check-in window. Creates a `PENDING` verification (15 min). | MVP |
| FR-ATT-2 | Check-in step 2: scan the QR of the **same** location; valid token + unexpired verification → attendance **CONFIRMED**, point awarded. | MVP |
| FR-ATT-3 | GPS alone never confirms attendance; no point is awarded before QR success. | MVP |
| FR-ATT-4 | Exactly one classification per employee per date: `GREEN`/`WHITE`/`RED`/`BLACK`. | MVP |
| FR-ATT-5 | Check-out: GPS + geofence validation; records time; awards overtime Greens. | MVP |
| FR-ATT-6 | Admin manual check-in/out and correction (reason mandatory, audited, point effects through ledger reversal + new award). | MVP |
| FR-ATT-7 | Employee attendance history. | MVP |

### 4.4 Points
| ID | Requirement | Priority |
|---|---|---|
| FR-PTS-1 | Point ledger is **append-only**; one row = one point (+1) or one reversal (−1). Never UPDATE/DELETE. | MVP |
| FR-PTS-2 | Offset engine: Greens cancel Reds (1:1, oldest Red first), then Blacks (5:1, atomic, no partial). | MVP |
| FR-PTS-3 | A Green consumed by an offset is never counted again as Fund value. | MVP |
| FR-PTS-4 | Offsets only touch points in **open** (unlocked) months. | MVP |
| FR-PTS-5 | Admin add (any type), reverse/void with reason; a point can be reversed once; reversal of an offset participant undoes the whole offset group and re-runs the engine. | MVP |
| FR-PTS-6 | WHITE is visible in history but takes no part in offsets, bonus or deduction. | MVP |

### 4.5 Leave & Early Leave
| ID | Requirement | Priority |
|---|---|---|
| FR-LV-1 | Leave types `ANNUAL`, `SICK`, `UNPAID`; full days only; request range `from..to`. | MVP |
| FR-LV-2 | Admin approve / reject / cancel approval. Approved leave ⇒ attendance exempt: **no Red, no Black, no Green**. | MVP |
| FR-LV-3 | Salary treatment per leave type is configurable (`leave_pay_policy`); not hardcoded. | MVP |
| FR-LV-4 | Accrual, carry-over, balances, half-day leave, many categories. | Out of Scope / Future |
| FR-EL-1 | Employee requests early leave (date, requested checkout time, reason) → `PENDING`. | MVP |
| FR-EL-2 | Approve: actual checkout recorded, no penalty, **no overtime Green**, reason + approver preserved. Reject: nothing special; normal policy applies; **no new point type**. | MVP |

### 4.6 Payroll, Fund, Payments
| ID | Requirement | Priority |
|---|---|---|
| FR-PAY-1 | Payroll preview (same pure calculator as close) and Month Close that locks the month in one DB transaction. | MVP |
| FR-PAY-2 | Month Close freezes the USD→EGP rate (required input, no default). | MVP |
| FR-PAY-3 | Red/Black deductions applied only when enabled in `deduction_policy` (default **disabled**, DN-01). Potential amounts are always shown. | MVP |
| FR-PAY-4 | Unused Greens at close become a `MONTH_CLOSE_CREDIT` fund row (append-only). | MVP |
| FR-PAY-5 | Locked month is immutable; later corrections are payroll adjustments / fund adjustments in an open month. | MVP |
| FR-FUND-1 | Fund balance = `SUM(fund_transactions.amount)` from PostgreSQL only. | MVP |
| FR-FUND-2 | Withdrawal: transaction-safe, idempotent (`Idempotency-Key`), debits ledger, creates payout + outbox event atomically. | MVP |
| FR-PAYOUT-1 | States `PENDING → PROCESSING → PAID` or `FAILED`; Paymob timeout never means FAILED; inquiry decides. | MVP |
| FR-PAYOUT-2 | FAILED ⇒ compensating `WITHDRAWAL_REFUND` row (never edit ledger). | MVP |
| FR-PAYOUT-3 | Signed webhook (hint) + inquiry (truth) + manual fallback by admin. | MVP |
| FR-PAYOUT-4 | Salary payouts via Paymob. | Later |

## 5. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 Correctness | All point/money rules covered by unit tests and golden cases (`05-SYSTEM_DESIGN.md` §15). |
| NFR-2 Integrity | PostgreSQL is the single source of truth; critical operations run in a DB transaction with `SELECT … FOR UPDATE` on the per-user lock row; money in `NUMERIC`, handled with a decimal library. |
| NFR-3 Idempotency | Every retried job/endpoint is safe to run twice (unique keys, state guards). |
| NFR-4 Time | Server time only; UTC storage; `Africa/Cairo` for business rules; injectable `Clock`. |
| NFR-5 Security | argon2id, rotating refresh tokens, RBAC guards, encrypted payout accounts, signed webhooks, no secrets/PII in logs, TLS. |
| NFR-6 Auditability | Every admin mutation and payout event → `audit_logs` (before/after) inside the same transaction. |
| NFR-7 Availability | Single-company scale (hundreds of employees). Redis outage must not corrupt data or block attendance (see Edge Cases). |
| NFR-8 Performance | Check-in/confirm p95 < 500 ms at this scale; indexes in `08-DATABASE_SCHEMA.md`; offset engine O(open points per user). |
| NFR-9 Observability | Structured JSON logs with request ID; health endpoints; failed jobs and stuck payouts alert admins. |
| NFR-10 Operability | Migrations only; daily DB backup; Docker deployment; Swagger at `/api/docs`; API versioned `/api/v1`. |

## 6. Business Rules

### 6.1 Attendance windows (default schedule 08:00–16:00)

| Check-in time (server, Cairo) | Classification | Point |
|---|---|---|
| before 08:00 | not open | rejected `CHECKIN_NOT_OPEN` — **DN-04** |
| 08:00:00 – 08:59:59 | EARLY | **+1 GREEN** |
| 09:00:00 – 09:59:59 | NORMAL | **+1 WHITE** |
| 10:00:00 – 11:59:59 | LATE | **+1 RED** |
| 12:00:00 + | ABSENT window (no check-in accepted) | **+1 BLACK** by system if no attendance / approved leave / off-day-work exception |

The window offsets come from the employee's effective `WorkSchedule` (60/60/120 minutes after `work_start`); the table above is the default.

**Which timestamp is classified?** The server time at which the GPS step **started** the verification (`check_in_at = verification.started_at`). Otherwise the 15-minute QR window would silently turn a 09:55 NORMAL attempt into a 10:05 RED. *Provisional — DN-05.*

**No Black while a verification is pending.** The absence job skips an employee who has an unexpired `PENDING` verification for that day (an attempt at 11:55 may legitimately finish at 12:05). If it expires unscanned, the next sweep creates the Black. *Derived consequence of the 15-minute rule — DN-05.*

### 6.2 One classification per day
Per (employee, date) there is **at most one** attendance classification. Enforced by `UNIQUE(user_id, work_date)` on `attendance`, by a unique `dedupe_key` on the awarded point, and by the single-writer lock (see schema invariants). Admin corrections replace the classification by **reversing** the old point and awarding a new one with `classification_rev + 1`.

### 6.3 Point rules
| Event | Result |
|---|---|
| Confirmed check-in 08:00–08:59 | +1 GREEN (source `ATTENDANCE`) |
| Confirmed check-in 09:00–09:59 | +1 WHITE |
| Confirmed check-in 10:00–11:59 | +1 RED |
| Absence | +1 BLACK |
| Check-out overtime | +N GREEN (source `OVERTIME`), N = floor(minutes_after_end / 60) |
| Admin add | +1 per unit, source `ADMIN`, reason mandatory |
| Reversal | −1 row referencing the target (once only) |

WHITE: shown in history; no role in offsets, bonus or deduction.

### 6.4 Green offset rules
```text
GREEN ─┬─ cancel RED    (1 : 1, oldest active RED first)
       ├─ cancel BLACK  (5 : 1, all five required, atomic, no partial)
       └─ remaining at Month Close → Fund credit (1 Green = 1 USD)
```
- A consumed Green is **never** counted again as Fund value.
- Offsets act only on points whose payroll month is still open.
- Order inside one engine run: Reds first (oldest first), then Blacks (oldest first). Greens are consumed oldest first. *Reds-before-Blacks and oldest-Green-first are carried over from v2; the SoT fixes only "oldest Red first" — DN-09.*
- Overtime Greens follow the same lifecycle; there is **no separate overtime mechanism** — they enter the same Green pool. *Interpretation of SoT §12 "not automatically assigned" — DN-09.*

Worked example (SoT §10): 10 Greens earned, 2 Reds → 2 Greens cancel 2 Reds, **8** Greens remain → Fund credit **8 USD** (not 10).

### 6.5 Checkout and overtime
- Work end 16:00; normal checkout window `[16:00, 17:00)`; overtime starts at the window end.
- `overtime_greens = floor(minutes_after_shift_end / 60)` where `minutes_after_shift_end` = whole minutes between schedule end and server checkout time.
- Examples: 16:59 → 0 · 17:01 → 1 · 18:01 → 2 · 19:01 → 3 (SoT examples satisfied).
- Boundary: exactly 17:00:00 yields 1 under the literal formula. **DN-06** confirm.
- Checkout is accepted only on the same Cairo `work_date` as the check-in.
- Approved early leave on that date ⇒ **0** overtime.
- Overtime Greens have real money value (1 USD each): a **daily cap** and whether checkout also needs QR are **DN-07** (MVP default: no cap, GPS + geofence only).
- Checkout earlier than shift end without an approved early leave: recorded, flagged `left_early` for admin visibility, **no penalty** (none defined by SoT) — **DN-08**.

### 6.6 Leave rules
- Types: `ANNUAL`, `SICK`, `UNPAID`; full days only; range `from_date..to_date`.
- Only **working days** inside the range count (weekly off days/holidays ignored).
- Statuses: `PENDING → APPROVED | REJECTED`; `APPROVED → CANCELLED` (admin); employee may cancel own `PENDING`.
- Approved leave ⇒ no check-in expected; no Red/Black/Green for those dates.
- Leave approved **after** a Black exists: the Black is reversed (reason `LEAVE_APPROVED`), attendance row becomes `EXEMPT`, affected offsets are undone and the engine re-runs. Blocked if any covered date is in a locked month (admin uses payroll/fund adjustment).
- Approval is **blocked** for dates that already have a `CONFIRMED` attendance (admin corrects attendance first).
- Cancelling an approval after the absence threshold has passed re-creates the Black immediately (new classification revision).
- Salary effect per type from `leave_pay_policy` (seed: `UNPAID` deducts `daily_rate` per day, `ANNUAL`/`SICK` do not) — **DN-02**.
- Overlapping non-rejected requests for the same employee are refused.

### 6.7 Early leave rules
| State | Effect |
|---|---|
| `PENDING` | Visible to admin. |
| `APPROVED` | Actual checkout recorded; no penalty; **no overtime Green**; reason + `reviewed_by` stored; audited. |
| `REJECTED` | If the employee checks out, it is recorded; existing attendance policy applies; **no new point type**. |

One active (`PENDING`/`APPROVED`) request per employee per date.

### 6.8 QR verification flow
```text
Check-in attempt ─► server validates GPS + geofence + accuracy
                 ─► PENDING verification (expires_at = started_at + 15 min)
Employee scans company QR ─► server validates token (HMAC, location, slot ≤ 60 s old)
                 ─► attendance CONFIRMED ─► point awarded
After 15 minutes ─► EXPIRED (no attendance, no point)
```
- QR is generated by the server per location, rotates every 30 s; **no static QR**. Displayed on an admin-authenticated screen at the branch (kiosk page) — **DN-16**.
- Verification is bound to employee + location + day; single use.
- Accuracy threshold default 50 m (**DN-14**).

### 6.9 Payroll & Fund
```text
Net Payroll (EGP) = Base Salary
                  − Leave deduction (types marked unpaid in policy)
                  − Applied Red deductions     (only if deduction policy enables Reds)
                  − Applied Black deductions   (only if deduction policy enables Blacks)
                  ± Approved payroll adjustments

Fund credit (USD) = remaining (unconsumed, unreversed) Greens × 1 USD
```
- Potential deductions are **always computed and shown**: `active Reds × 250`, `active Blacks × 1000`.
- Applied deductions follow `deduction_policy` (default off) and an optional cap (DN-01). **No assumption that deductions are legal.**
- Green bonus delivery: SoT §20 makes unused Greens a **Fund credit**; paying it through salary instead is **DN-03** (not built).
- USD→EGP: never hardcoded; supplied at Month Close, frozen on `payroll_months`, used for EGP-equivalent display only.
- Mid-month salary change / mid-month join: **DN-11**. Provisional: salary changes must start on the 1st of a month; partial-month employees are flagged `partial_month` and the admin enters a payroll adjustment (no auto-proration).

### 6.10 Payment behavior
- Withdrawal needs: sufficient fund balance, active payout method (not in cooldown), limits (DN-13), `Idempotency-Key`.
- Currency: fund is held in **USD**. Payout converts to EGP using a configured payout rate snapshotted on the payout — rate source is **DN-03**.
- Failure ⇒ refund row. Timeout ⇒ stays `PROCESSING` ⇒ inquiry. Fees: **DN-13**.

## 7. Admin Capability Matrix (SoT §17)

| Area | Capabilities | Audit |
|---|---|---|
| Employees | create, update, disable, reactivate, set salary | ✔ |
| Attendance | view, manual check-in/out, correction | ✔ |
| Points | add G/W/R/B, void, reverse, view full history | ✔ |
| Leave / Early leave | approve, reject, cancel approval (leave) | ✔ |
| Schedules | create, update, assign, modify **future** assignments | ✔ |
| Calendar | holidays, weekly off days, off-day-work exceptions | ✔ |
| Payroll / Fund | preview, close/lock, adjustments (ledger entries), fund review, payouts | ✔ |
| Settings | policies, limits | ✔ |

"Change quantity where policy permits" = reverse + re-add with reason; per-action quantity limit **DN-18**. "Cancel eligible points" = reverse/void (offset cancellation is a system action).

## 8. Edge Cases — Expected Behavior

| # | Case | Expected behavior |
|---|---|---|
| 1 | Duplicate check-in | Confirmed attendance exists → `409 ALREADY_CHECKED_IN`. Unexpired `PENDING` verification exists → returns the **same** verification (200). Never a second point. |
| 2 | Duplicate checkout | `409 ALREADY_CHECKED_OUT`; no extra Greens (unique `dedupe_key` per overtime unit). |
| 3 | GPS outside geofence | `422 OUTSIDE_GEOFENCE`; no verification, no point. |
| 4 | Poor GPS accuracy | `422 GPS_ACCURACY_TOO_LOW` (accuracy > threshold); employee retries. |
| 5 | QR expired | Token older than 2 slots → `422 QR_TOKEN_INVALID`; verification older than 15 min → `410 VERIFICATION_EXPIRED`; employee starts a new check-in (classified by the new start time). |
| 6 | QR replay | Token is valid ≤ ~60 s, only with the caller's own `PENDING` verification for the same location; a confirmed verification cannot be reused (`409`). A photo forwarded to a colleague only helps if they also passed GPS+geofence in the last 60 s (residual risk accepted for MVP). |
| 7 | Verification started, QR never scanned | Sweeper marks `EXPIRED` after 15 min; no attendance/point; employee may retry while the window is open; after the absence time the next sweep creates the Black. |
| 8 | Leave approved after Black created | Black reversed (`LEAVE_APPROVED`), attendance `EXEMPT`, offsets undone + engine rerun (open month). Locked month → approval refused with `MONTH_LOCKED`. |
| 9 | Leave rejected | No change to points. |
| 10 | Early leave approved | Checkout recorded, no penalty, no overtime Green, approver + reason stored. |
| 11 | Early leave rejected | No special effect; normal attendance policy; no new point type. |
| 12 | Future schedule change | Assignments change only with `effective_from > today` (initial assignment excepted); past attendance keeps its `schedule_snapshot`; locked/past dates are not re-evaluated. |
| 13 | Salary changed mid-month | DN-11. Provisional: `effective_from` must be the 1st of a month, otherwise `422`. |
| 14 | Employee joins mid-month | No Black before their first assignment date; payroll record flagged `partial_month`; no auto-proration (DN-11). |
| 15 | Employee disabled | Tokens revoked, login blocked; no Blacks from `disabled_at` date on; ledgers untouched; new withdrawals blocked, balance preserved for admin/manual handling (DN-13). |
| 16 | Month locked | All point/offset/payroll inserts for that month rejected (service + DB trigger). Corrections → payroll/fund adjustments in an open month. |
| 17 | Admin reverses wrong point | A reversal cannot itself be reversed; admin adds a new point citing the original; offsets recomputed; both rows audited. |
| 18 | Queue retries | Handlers are idempotent (state guards + unique keys); exponential backoff; exhausted jobs go to the failed set + admin alert. |
| 19 | Redis unavailable | Attendance, points, payroll keep working (PostgreSQL only). Outbox rows stay `PENDING` and are published when Redis returns; sweeper catches up via lookback; login throttle falls back to an in-process limiter. Money state is never read from Redis. |
| 20 | Paymob timeout / 5xx / network error | Payout stays `PROCESSING`; inquiry by `client_reference`; only a definitive provider answer sets `PAID`/`FAILED`. |
| 21 | Paymob duplicate request | Same `client_reference` is always reused; inquiry before any resend; our `UNIQUE(client_reference)` and webhook-event uniqueness make duplicates harmless. |
| 22 | Check-in on holiday/off day | Rejected `NOT_A_WORKING_DAY` unless an off-day-work exception exists (then normal windows/points — DN-12). |
| 23 | Two concurrent check-ins | One wins (`UNIQUE` pending verification / attendance); the other gets the idempotent response above. |
| 24 | Admin manual check-in for an absent day | Black reversed (`ATTENDANCE_CORRECTION`), classification recomputed from the supplied time using the same windows (≥12:00 stays BLACK), new revision awarded, offsets rerun. |
| 25 | Withdrawal exceeds balance / concurrent withdrawals | Per-user row lock serializes; second sees reduced balance → `422 INSUFFICIENT_FUND`. |
| 26 | Admin and absence job race | Both take the same user lock; unique `dedupe_key` prevents a duplicate award. |
| 27 | DST change in Africa/Cairo | Windows computed in local time with Luxon; stored as UTC instants; `work_date` is the Cairo calendar date. |
| 28 | Webhook arrives for an already-final payout | Stored, ignored for state; mismatch (e.g., `PAID` after manual `FAILED`) raises an admin alert, resolved manually. |

## 9. DECISION NEEDED Register

| ID | Question | Provisional default used in docs |
|---|---|---|
| DN-01 | Legal validity/limits of Red & Black salary deductions; cap? | `deduction_policy` red/black **disabled**; potentials always shown. |
| DN-02 | Salary treatment per leave type. | `UNPAID` deducts, `ANNUAL`/`SICK` do not (configurable). |
| DN-03 | Green bonus paid as Fund (assumed, SoT §20) vs salary; fund currency; source of USD→EGP rate for **withdrawals**. | Fund in USD; payout uses a configured rate snapshotted on the payout. |
| DN-04 | Check-in before 08:00. | Reject `CHECKIN_NOT_OPEN`. |
| DN-05 | Timestamp used to classify; pending verification protects from Black. | Verification start time; yes. |
| DN-06 | Overtime at exactly 17:00:00 (literal formula gives 1). | Literal formula. |
| DN-07 | Daily overtime cap; QR at checkout. | None; GPS+geofence only. |
| DN-08 | Penalty for checkout before shift end without approved early leave. | None, flagged. |
| DN-09 | Reds-before-Blacks priority; oldest-Green-first; reading of "overtime Greens not automatically assigned". | As in §6.4. |
| DN-10 | Seed weekly off days and holiday list. | Admin enters; no seed assumed. |
| DN-11 | Mid-month salary change / join proration. | See §6.9. |
| DN-12 | Off-day work: classification on exception days; employee request flow. | Normal windows/points; admin-granted only. |
| DN-13 | Withdrawal min/daily/monthly limits, fee bearer, payout-method cooldown, multiple methods, disabled-employee withdrawals. | Settings exist (`withdrawal_limits`, cooldown); a positive minimum withdrawal must be configured before go-live; one active method. |
| DN-14 | GPS accuracy threshold. | 50 m. |
| DN-15 | Paymob: idempotency on send, webhook signature scheme, account approval/fees, wallet owner-name check. | Verified in sandbox in Phase 7. |
| DN-16 | Employee client & Admin frontend stack; kiosk QR authentication. | Decided: Employee client is React Native (Expo) mobile app; Admin & Kiosk is Next.js web application. |
| DN-17 | Month Close pre-checks (pending leaves block close) and single-transaction size limit. | Block on pending leave/early-leave in month; one transaction. |
| DN-18 | Max quantity per admin point action. | Setting `admin_point_max_quantity`; one ledger row per unit. |
| DN-19 | Hosting provider and backup/PITR approach. | Docker Compose on one host, daily backups. |

## 10. Superseded v2 Rules (must NOT be reused)

| v2 rule | Replaced by |
|---|---|
| 3-minute overtime Green | `floor(minutes after end / 60)` |
| "30 points = $40 (≈2200 EGP)", REDEEM −30 | 1 unused Green = 1 USD at Month Close; Fund ledger |
| "Staff / Owner" terminology | `EMPLOYEE` / `ADMIN` |
| Windows 07:00/10:00/11:00/12:00; early Green, **on-time Green (not offsettable)** | 08–09 GREEN, 09–10 WHITE, 10–12 RED, 12+ BLACK; every Green offsettable |
| `can_offset` flag, `offsettable Greens`, 5 Greens per Black with Green always paid even when used | Consumed Greens never paid again |
| Half-day leave, day-by-day leave approval, weekly off in leave logic | Full-day leave types ANNUAL/SICK/UNPAID |
| `users.shift_id`, `shifts` | `work_schedules` + `schedule_assignments` |
| Wi-Fi / device binding / mock-location flags | GPS + geofence + QR only |
| Cursor pagination, audit partitioning | Plain pagination; no partitioning |
| Salary payouts through Paymob; "Salary = base − fund_credit + Σ Greens…" formula | Fund withdrawals only; formula in §6.9 |
| Employee off-day-work request (v2 MVP) | Admin-granted exception (request flow Later) |

## 11. Out of Scope (restated)
See `01-PROJECT_BRIEF.md` §6. Anything not listed in the requirement tables as `MVP` is not built in this version.
