# 09 - Decision Log (documentation reconciliation)

| Field | Value |
|---|---|
| **Version** | 1.1 |
| **Date** | 2026-10-22 |
| **Scope** | Reconciles `docs/01` to `docs/08`, `README.md` and `AGENTS.md` with the planning spec, and records the agreed schema direction. Code changed so far: only the `PointType` enum in `schema.prisma`. |
| **Business authority** | `planning/docs/planning/SYSTEM_SPECIFICATION.md` **v0.3.0**, approved by Mohand Hatem on 2026-10-22 (CHG-003), with `planning/PROJECT_BRIEF.md` v3.6. `planning/` is a **local workspace kept out of git** (renamed from `OpenAi Project Generator/`); this log is the shared record of what it decided. |
| **Technical authority** | `docs/`; for existing tables, `apps/api/prisma/schema.prisma` is the base model and changes to it are additive. |

## 1. Rules used

1. A decision marked **CONFIRMED** in the spec overrides `docs/` and code.
2. **PROPOSAL / ASSUMPTION / OPEN QUESTION** items are not promoted. Where a proposal differs from `docs/`, the `docs/` behaviour stays as a provisional default and is listed as a `DN-xx` item in `02-PRD.md` §9.
3. Technical decisions in `docs/` are kept unless a confirmed requirement needs them to change.
4. When the spec does not resolve a critical point, it is reported (section 5), not decided.
5. Business changes go spec → `docs/` → code (`AGENTS.md` Rule 5).
6. `schema.prisma` (2026-10-22 model) is the base for the tables it contains. Nothing is deleted from it; mismatches with the spec are fixed by **adding** columns/models or by service rules, and `docs/08` marks each addition **[ADD]**.

## 2. Confirmed business decisions (authoritative)

| ID | Decision | Spec source | Applied in |
|---|---|---|---|
| D-01 | EGP is the only currency. No USD, no conversion, no exchange rate. | REQ-020, Brief §10.1 | 01, 02, 03, 05, 06, 07, 08, README |
| D-02 | The value of one unused GREEN is Admin-configurable (never hard-coded). | REQ-029 | 02 (FR-PTS-7), 08 |
| D-03 | Initial GREEN value is 1000 EGP, always > 0. | AC-REQ-029-01/02 | 01, 02, 05 (G1–G9), 08 |
| D-04 | RED 250 EGP and BLACK 1000 EGP are potential deductions, Admin-configurable, OFF by default. | REQ-020 | already consistent |
| D-05 | The employee bears the Paymob fee. Actual fee and minimum are an accepted gap (configuration before go-live). | AC-REQ-026-05 | 02 (FR-FUND-3), 05 §10, 08 |
| D-06 | Off-day work: 1 GREEN regardless of check-in time, plus a day's pay of monthly salary / 30 (divisor always 30, 1x rate, half-up to 0.01) using the salary version effective that day. | REQ-030 | 02 (FR-CAL-3), 05, 07, 08 |
| D-07 | REDs are offset before BLACKs. | AC-REQ-018-06 | 02 §6.4, 05 (G8) |
| D-08 | Geofence radius is 50 m. | AC-REQ-009-01 | 02 §2 |
| D-09 | Check-in needs GPS inside the geofence plus a QR validated within 15 minutes; server time only. | REQ-011, REQ-NFR-003 | already consistent |
| D-10 | One company per deployment; no tenancy **behaviour** in the MVP. | Spec §11 | 01, 08 §3.0, README |
| D-11 | Tenancy-ready data model: exactly one company row; every company-owned record references it; the company is resolved on the server, never from client input; no create-company / register / invite endpoint. | **REQ-NFR-008 (v0.3.0)** | 01, 08 §3.0, 06 (TASK-041) |
| D-12 | Two active roles (`ADMIN`, `EMPLOYEE`) on a small RBAC foundation. | REQ-003 | 02 (FR-AUTH-3), 04, 08 |
| D-13 | WHITE is visibility only. Ledgers are append-only. No leave accrual or carry-over. | AC-REQ-012-03, REQ-017, REQ-021 | already consistent |

No two CONFIRMED decisions conflict with each other.

## 3. Conflict register

| # | Topic | Conflicting statements (source) | Decision | Status |
|---|---|---|---|---|
| C-01 | Currency | `docs/` v3.0: fund in USD, `usd_egp_rate`, `fund_credit_usd`, `amount_usd`, `fx_rate`, `{usdEgpRate}`. Spec: EGP only. | EGP only (D-01). USD columns and FX input removed from docs; `fee_egp` / `net_egp` on `payouts`; `payroll_records` gets `off_day_*` and `fund_credit_egp`. | Done |
| C-02 | Money storage | Spec proposes integer piasters. Docs: `NUMERIC(14,2)`. Schema: `Decimal(14,2)` plus `value_per_point_piasters` (BigInt). | Keep `NUMERIC(14,2)`; the ledger snapshot is the only piaster column. | Open: DN-23 |
| C-03 | Tenancy | Spec v0.2.0: no tenancy. Commit `98153f9`: companies, invitations, `company_id` everywhere. | **Resolved by spec v0.3.0** (D-10 + D-11): single-company behaviour on the existing tenancy-ready schema; `company_invitations` and `owner_user_id` kept but unused. | Done |
| C-04 | Salary versioning | Docs had `employee_salaries` (user-keyed); schema has `EmployeeSalaryVersion` (employee-keyed, no unique). | Schema table `employee_compensation_versions` kept; **[ADD]** `UNIQUE(employee_id, effective_from)`; salary > 0 and first-of-month (provisional) as service rules. | Docs done; granularity open: DN-11 |
| C-05 | Point values and type | Docs: GREEN in USD; schema: `point_type` free text. | `point_value_versions` in EGP, GREEN seed 1000; **`enum PointType {GREEN, WHITE, RED, BLACK}` added to the schema** (2026-10-22); WHITE excluded from value rows by service rule; **[ADD]** unique per type and date. | Enum done; fund valuation timing open: DN-21 |
| C-06 | Off-day work | Docs DN-12: normal windows/points. Spec: 1 GREEN + salary / 30. | Spec rule (D-06). | Done; time bounds DN-20 |
| C-07 | Refresh token lifetime | Spec proposal 7 days; README / `.env.example` / docs 30 days. | Keep 30 days. | Open: DN-22 |
| C-08 | QR rotation and validity | Spec: validated within 15 minutes; proposal: code valid at most 15 min. Docs: 30 s rotation + 15-min verification window. | No real conflict; kept. | Closed |
| C-09 | Performance targets | Spec proposals (p95 2 s, 99.5%); docs NFR-8 p95 < 500 ms. | Keep NFR-8; proposals recorded as NFR-11 (PROPOSAL). | Open (stakeholder) |
| C-10 | Payout states | Spec proposal `REQUESTED/SUBMITTED/SUCCEEDED/FAILED/MANUAL_REVIEW`; docs `PENDING/PROCESSING/PAID/FAILED` + `needs_attention`. | Keep docs states; mapping REQUESTED = PENDING, SUBMITTED = PROCESSING, SUCCEEDED = PAID, MANUAL_REVIEW = `needs_attention` + admin fallback. | Closed |
| C-11 | `WorkOffer` / `AdditionalWorkCalculation` / `monthly_hours_divisor` | Schema-only; hourly divisor conflicts with D-06. | **Team decision 2026-10-22:** `work_offers` (type `OFF_DAY_WORK`) is the off-day exception record; `additional_work_calculations` stores its pay with divisor **30** and `green_points_awarded = 1`; `monthly_hours_divisor` unused for pay. Nothing deleted. | Done (DN-24 closed) |
| C-12 | RBAC modelling | Docs: `users.role_id`. Schema: `user_roles` many-to-many + `permissions` table. | Keep the schema shape; **exactly one role per user in the MVP**, enforced by the users service. | Done |
| C-13 | Local PostgreSQL vs Neon | README Neon only; compose has local Postgres; `.env.example` mixes both. | Docker Postgres for local dev, Neon for shared environments; `DATABASE_URL` and `DIRECT_URL` must point at the same database. | Documented; `.env.example` fix is code |
| C-14 | Reds before Blacks | Docs DN-09 treated it as a default. Spec: CONFIRMED. | DN-09 part closed; golden case G8. | Done |
| C-15 | Fund currency and payout conversion | Docs §6.10 / DN-03: USD fund converted at payout. | Removed (D-01). | Done |
| C-16 | User vs employee | Docs used one `users` table; schema splits `users` (login) and `employees` (person). | Keep the split. **[ADD]** `users.must_change_password`, `employees.active_from`, `employees.deactivated_at` (needed by FR-AUTH-5 and the absence job). Later-phase tables reference `employees.id`. | Done in docs |
| C-17 | Check-in windows | Docs `work_schedules` (early/normal/late minutes). Schema `shift_versions` (grace/red-period minutes only). | Keep shift versions; **[ADD]** `early_minutes` (default 60). Read `grace_minutes` = WHITE end (120) and `red_period_minutes` = RED end (240). **[ADD]** `attendance_days.early_end_at` and `classification`. | Done in docs; interpretation to confirm with the model's author |
| C-18 | Audit table | Docs `audit_logs`; schema `audit_events`. | Keep `audit_events` (`changes` holds before/after); **[ADD]** `actor_type`, `request_id`. | Done in docs |
| C-19 | Attendance excuses | Schema has `attendance_excuses`; no requirement. | Kept, unused in MVP. | Open: DN-26 |
| C-20 | Login protection | Spec proposal: account lockout (5 failures → 15 min). Docs/code: rate limit per email+IP (429). v1.0 of this log wrongly called them the same. | Keep the rate limit; recorded as planning GAP-024. | Open: DN-27 |
| C-21 | Missing models | Schema has no `refresh_tokens` or `settings`, which the auth/users code and Step 1.5 need. | **[ADD]** both (`settings` keyed by `(company_id, key)`). Other later-phase tables arrive with their roadmap phase. | Step 4 |

## 4. Spec proposals and how they were handled

| Proposal | Handling |
|---|---|
| Refresh token 7 days | Not adopted (DN-22). |
| Account lockout 5 failures / 15 min | Not adopted; the rate limit stays (DN-27). Access token 15 min is already in docs. |
| Password minimum 10 chars; admin cannot demote or deactivate self; at least one active Admin | Not in docs; left as PROPOSAL. |
| GPS accuracy 30 m | Not adopted; docs keep 50 m (DN-14). |
| Absence job daily at 12:05 | Not adopted; the sweeper runs every minute with lookback. |
| Offboarding converts Greens to fund | Not in docs; left as PROPOSAL. |
| Fee mechanics (show fee and net, reject if too small) | Adopted only as needed for D-05 (FR-FUND-3). |
| Webhook secret rotation 90 days | Left as PROPOSAL. |
| Backups, 7-year retention, 99.5%, WCAG 2.1 AA, 200-employee sizing | Recorded as NFR-11 to NFR-13 (PROPOSAL). |
| Integer piasters | Not adopted (DN-23). |
| No overtime Greens on off-day work | Provisional default (DN-20). |
| Notification events list | Recorded in FR-NOTIF-1 as PROPOSAL. |
| Legal-review reference before deductions can be turned on | Left as PROPOSAL (DN-01 open). |

## 5. Still open (not decided here)

| ID | Question | Owner |
|---|---|---|
| DN-11 | Salary effective date: 1st of month (current) or any day (proposal)? | Stakeholder |
| DN-20 | Off-day work: accepted check-in times; overtime that day? | Stakeholder |
| DN-21 | Fund credit uses the GREEN value at Month Close or at each Green's work date? | Stakeholder |
| DN-22 / DN-23 | Refresh token lifetime; money representation. | Team |
| DN-25 | 1000 EGP Green vs 250 EGP Red: intended? (GAP-018) | Stakeholder |
| DN-26 | Is an employee excuse flow wanted (`attendance_excuses`)? | Stakeholder |
| DN-27 | Lockout vs rate limit. | Stakeholder / team |
| C-17 | Confirm the grace / red-period reading with the author of the 2026-10-22 model. | Model author |
| U-5 | How a point offset is undone after a reversal (`point_offset_allocations` has no APPLY/UNDO). | Phase 4 |
| Q-9 | Which spec proposals does the stakeholder accept (section 4)? | Stakeholder |

## 6. Traceability: spec REQ-* to `docs/` FR-* / sections

| REQ | Implementation requirement |
|---|---|
| REQ-001, REQ-002 | `02` §3 user stories, FR-AUTH-4, §7 admin matrix |
| REQ-003 | FR-AUTH-3, FR-AUTH-6 |
| REQ-004 | `05` §12 background jobs |
| REQ-005 | `04` §7, `05` §11 |
| REQ-006 | FR-AUTH-1, FR-AUTH-2, FR-AUTH-5; `05` §3 |
| REQ-007 | FR-EMP-1 |
| REQ-008 | FR-EMP-2 |
| REQ-009 | FR-LOC-1; `05` §4.2 |
| REQ-010 | FR-SCH-1, FR-CAL-1, FR-CAL-2 |
| REQ-011 | FR-ATT-1, FR-ATT-2, FR-ATT-3; `05` §4.2-4.3; `07` §2-3 |
| REQ-012 | FR-ATT-4; `02` §6.1 |
| REQ-013, REQ-014 | FR-ATT-5; `02` §6.5; `07` §5-6 |
| REQ-015 | `02` §6.1; `05` §12; `07` §7 |
| REQ-016 | FR-ATT-6 |
| REQ-017 | FR-PTS-1 |
| REQ-018 | FR-PTS-2, FR-PTS-3, FR-PTS-4; `02` §6.4; golden G3-G5, G8 |
| REQ-019 | FR-PTS-5 |
| REQ-020 | FR-PAY-3 |
| REQ-021 | FR-LV-1 to FR-LV-4 |
| REQ-022 | FR-EL-1, FR-EL-2 |
| REQ-023 | FR-PAY-1, FR-PAY-2, FR-PAY-4, FR-PAY-5 |
| REQ-024 | FR-PAY-5; `05` §8.4 |
| REQ-025 | FR-FUND-1 |
| REQ-026 | FR-FUND-2, FR-FUND-3, FR-PAYOUT-1 to FR-PAYOUT-3 |
| REQ-027 | **FR-NOTIF-1 (new)** |
| REQ-028 | NFR-6; `05` §13; `08` `audit_events` |
| REQ-029 | **FR-PTS-7 (new)** |
| REQ-030 | **FR-CAL-3 (new)**; `08` `work_offers`, `additional_work_calculations` |
| REQ-NFR-001 | `01` §3 priority order |
| REQ-NFR-002, REQ-NFR-003 | NFR-2, NFR-4 |
| REQ-NFR-004 | NFR-10 |
| REQ-NFR-005 | NFR-8, NFR-11 |
| REQ-NFR-006 | NFR-10, NFR-12 |
| REQ-NFR-007 | NFR-13 |
| REQ-NFR-008 | **`08` §3.0 (new)**; planning TASK-041 / TEST-037 |

Phase-level mapping to planning tasks: `06-ROADMAP.md` "Traceability".

## 7. Schema and code changes (Step 4, 2026-10-22)

All additive; nothing was deleted from `schema.prisma`. Status: **done in code**, `tsc` 0 errors, build OK, 19 unit tests pass. **Not yet applied to any database** (`db push` pending approval).

1. `enum PointType` on `point_value_versions` and `point_ledger_entries`; `attendance_days.classification`.
2. New models `RefreshToken` and `Setting` (`(company_id, key)`).
3. New columns: `users.must_change_password`; `employees.phone`, `employees.active_from`, `employees.deactivated_at`; `shift_versions.early_minutes`; `attendance_days.early_end_at`; `audit_events.actor_type`, `audit_events.request_id`.
4. New uniques: `employee_compensation_versions (employee_id, effective_from)`; `point_value_versions (company_id, point_type, effective_from)`.
5. `CompanyContextService` (global): resolves the single company on the server and fails loudly unless exactly one row exists (AC-REQ-NFR-008-01/03).
6. Auth: roles and permissions read through `user_roles → roles → role_permissions → permissions`; `fullName` from `employees`. Token rotation and theft detection unchanged.
7. Users API (`/admin/users`): storage moved to `users` + `employees` + `user_roles` + `employee_compensation_versions`, scoped to the company; **response shape unchanged**. Contract notes: `employeeCode` is now **required** (schema `employee_number` is NOT NULL); `currency` is still accepted but **must be `EGP`**.
8. Seed rewritten: one company, roles/permissions, default shift with the confirmed windows, EGP point values, settings, development-only admin.
9. Service rules while `db push` is used: one role per user; WHITE never in value rows; salary > 0; no overlapping assignments; company resolved server-side. Not yet implemented: the WHITE and overlap rules (no endpoint writes those tables yet).

## 8. Observations outside the reconciliation

- `docker-compose.yml` commits a literal PostgreSQL password. Move it to `.env`.
- `.env.example` points `DATABASE_URL` at local Docker but `DIRECT_URL` at Neon.
- Planning workspace housekeeping is done in v0.3.0: §14 no longer states approval; `TASKS.json` regenerated (41 tasks); `TASKS.schema.json` still absent (GAP-019).
