# 09 - Decision Log (documentation reconciliation)

| Field | Value |
|---|---|
| **Version** | 1.2 |
| **Date** | 2026-10-25 |
| **Scope** | Reconciles `docs/01` to `docs/08`, `README.md` and `AGENTS.md` with the planning spec, and records the agreed schema direction. Code changed so far: only the `PointType` enum in `schema.prisma`. |
| **Business authority** | `planning/docs/planning/SYSTEM_SPECIFICATION.md` **v0.4.0**, approved by Mohand Hatem on 2026-10-25 (CHG-004), with `planning/PROJECT_BRIEF.md` v3.6. `planning/` is a **local workspace kept out of git** (renamed from `OpenAi Project Generator/`); this log is the shared record of what it decided. |
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
| D-10 | ~~One company per deployment~~ **superseded by v0.4.0**: the MVP is a multi-company foundation; self-service SaaS is Later. | CHG-004 (stakeholder, relayed 2026-10-25) | 01, 02, 08 §3.0, README |
| D-11 | Companies are created only by a provisioning command (REQ-031); employees join by invitation (REQ-032); one company per account; every read, mutation and refresh is company-scoped from the session, foreign records answer 404, employees reach only their own records (REQ-033); nothing may block a later SaaS (REQ-NFR-009). | **REQ-031–033, REQ-NFR-009 (v0.4.0)** | 01, 02 (FR-COMP-1–4), 08 §3.0, 06 (TASK-042–045) |
| D-12 | Two active roles (`ADMIN`, `EMPLOYEE`) on a small RBAC foundation. | REQ-003 | 02 (FR-AUTH-3), 04, 08 |
| D-13 | WHITE is visibility only. Ledgers are append-only. No leave accrual or carry-over. | AC-REQ-012-03, REQ-017, REQ-021 | already consistent |

No two CONFIRMED decisions conflict with each other.

## 3. Conflict register

| # | Topic | Conflicting statements (source) | Decision | Status |
|---|---|---|---|---|
| C-01 | Currency | `docs/` v3.0: fund in USD, `usd_egp_rate`, `fund_credit_usd`, `amount_usd`, `fx_rate`, `{usdEgpRate}`. Spec: EGP only. | EGP only (D-01). USD columns and FX input removed from docs; `fee_egp` / `net_egp` on `payouts`; `payroll_records` gets `off_day_*` and `fund_credit_egp`. | Done |
| C-02 | Money storage | Spec proposes integer piasters. Docs: `NUMERIC(14,2)`. Schema: `Decimal(14,2)` plus `value_per_point_piasters` (BigInt). | Keep `NUMERIC(14,2)`; the ledger snapshot is the only piaster column. | Open: DN-23 |
| C-03 | Tenancy | Spec v0.2.0: no tenancy. v0.3.0: one company, tenancy-ready. Commit `98153f9`: companies, invitations, `company_id` everywhere. | **Resolved by spec v0.4.0** (D-10 + D-11): real multi-company behaviour on the existing schema; one company per account; `company_invitations` and `owner_user_id` are now used. | Done in docs; code in progress |
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
| GAP-026 | How an invitee receives the invitation (one-time link shown to the Admin is the default). | Stakeholder |
| GAP-027 | Which settings are per company vs platform-wide: Paymob account, fees, legal gate, payroll timing. Blocks Phases 6–7. | Stakeholder |
| GAP-028 / GAP-029 | Support access for a company without an Admin; brief v3.7; row-level security as a later backstop. | Stakeholder / team |

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
| REQ-NFR-008 | DEPRECATED in v0.4.0 (superseded by REQ-031–033, REQ-NFR-009) |
| REQ-031 | FR-COMP-1; `08` §3.0, `companies`; planning TASK-043 / TEST-038 |
| REQ-032 | FR-COMP-2; `08` `company_invitations`; planning TASK-044 / TEST-039 |
| REQ-033 | FR-COMP-3; `08` §3.0; planning TASK-042, TASK-045 / TEST-040 |
| REQ-NFR-009 | FR-COMP-4; `08` §3.0; planning TASK-042 / TEST-041 |

Phase-level mapping to planning tasks: `06-ROADMAP.md` "Traceability".

## 7. Code status (2026-10-25)

Done for spec v0.4.0, verified on a fresh local PostgreSQL: `tsc` 0 errors, build OK, 35 unit tests, 28 e2e tests (19 new for provisioning, invitations and two-company isolation), and the three verify scripts.

1. Sessions: the JWT and `AuthenticatedUser` carry `companyId`; tokens without it are rejected (AC-REQ-006-07). Refresh re-derives claims from the account, so a refresh cannot switch company (AC-REQ-006-08). `JwtStrategy` no longer has a default secret: a missing `JWT_ACCESS_SECRET` stops the app at startup.
2. Scope: every `UsersService` method takes `companyId` as an explicit argument from the session. Another company's record answers 404 (AC-REQ-033-02/03). The earlier single-company service was removed (REQ-NFR-009).
3. Provisioning (REQ-031): `src/company/provision-company.ts` creates company, settings, point values, default shift and first Admin in one transaction. `npm run provision:company` needs `PROVISIONING_SECRET` (16+ chars) in the environment and a matching `--secret`; it prints a generated one-time password once. No HTTP route exists. Operator procedure, retries and lost-password recovery: `docs/11-PROVISIONING_RUNBOOK.md`.
4. Invitations (REQ-032): `POST/GET /admin/invitations`, `DELETE /admin/invitations/:id`, public `POST /auth/invitations/accept`. Token: 32 random bytes, only the SHA-256 hash is stored, 7-day expiry (proposal), single-use via an atomic claim, one pending invitation per company and email (service rule).
5. Seed: platform-wide roles and permissions always; a sample company only outside production, through the same provisioning function.
6. Tests: `test/company-isolation.e2e-spec.ts` (TEST-038/039/040) and the extended unit specs.

7. API documentation (2026-10-25): Swagger UI at `/api/docs`, importable OpenAPI at `/api/docs-json` and `docs/api/openapi.json` (15 operations, 25 schemas); `src/swagger.spec.ts` fails when the file is stale; `docs/10-API_TESTING_GUIDE.md` is generated from a real run (`npm run docs:guide`, 35 steps). New self-service route `GET /me/profile` (the owner comes only from the token).

8. Session hardening (2026-10-25), each proven by a test that failed first: (a) refresh rotation is one atomic claim, so two simultaneous refreshes cannot both succeed and the loser burns the family; (b) every request checks the account in the database: a deactivated user and a token whose company is not the account's are refused at once (access-token life no longer matters); (c) login throttling counts wrong credentials only, a success clears it, and the map cleans itself; (d) forced password change: global `PasswordChangeRequiredGuard` plus `PATCH /me/password` (ends all sessions, rate-limited); (e) CI job `api-e2e` runs the e2e suites on PostgreSQL.

9. Migrations and database-level rules (2026-10-25): `prisma/migrations` now holds the baseline plus `integrity_rules` (one pending invitation per email and per code, lower-case emails, one role per user, positive salary and point values, WHITE never has a value, ordered check-in windows, no overlapping shift assignments) and `audit_append_only` (no UPDATE, DELETE or TRUNCATE on `audit_events`). CI and shared databases use `prisma migrate deploy`; `db push` is for throwaway databases only. A migration that meets rule-breaking rows fails cleanly and changes nothing.
10. Audit events (REQ-028): every admin mutation (`user.create`, `user.activate`, `user.deactivate`, `salary.set`, `invitation.create`, `invitation.revoke`) and security event (`invitation.accept`, `password.change`, `company.provision`) is written in the same transaction as the change, so a failed action leaves nothing behind. Passwords, hashes and tokens never appear. `GET /admin/audit-events` (permission `audit.read`) is company-scoped, paginated and filterable.

11. Bootstrap hardening (TASK-043, 2026-10-25, approved by Mohand Hatem): the platform operator is the only initiator; the first Admin gets a random one-time password handed over privately; a repeat run with the same slug and Admin email answers "already provisioned" and changes nothing; a different email on a taken slug, or an email already in use, is refused with a message that names which one collided; a lost first password is recovered by an operator in the database (documented, no reset command). The command logic lives in `src/company/provision-command.ts` and is unit tested; `test/provisioning.e2e-spec.ts` covers the owner link, the ADMIN role, company scope, retries and the no-secrets rule.

12. Web and mobile auth transport (2026-10-26, approved by Mohand Hatem): one auth core, two transports. Mobile and tools use the bearer header; web asks for cookie mode with `X-Auth-Mode: cookie` and gets `HttpOnly`, `SameSite=Lax` cookies plus an `X-CSRF-Token` for writes. The header wins when both are present. CORS is now an allowlist (`CORS_ORIGINS`) instead of open to every origin. Details: `docs/03` (Authentication) and `docs/05` §3.

**Known gaps (not done):** (a) the ownership helper for employee-facing routes arrives with the first such route (Phase 3); today employees are blocked from every admin route and `/me/profile` has no id; (b) an Admin learns whether an email already has an account in any company, because email is globally unique (GAP-029); (c) login throttling is in memory and per instance, move it to Redis before running more than one instance (DN-27); (d) Neon was brought up to date on 2026-10-25: the old Step 1.1 tables (5 users, 6 salaries, 16 refresh tokens) were moved untouched into the schema `legacy_step11`, then the three migrations were applied and the seed run. Drop `legacy_step11` once nobody needs it (`DROP SCHEMA legacy_step11 CASCADE;`). Apply future migrations to Neon with the direct (non-pooled) URL; (e) audit events do not store a request id yet, and failed or denied attempts are not logged (only successful changes).

## 8. Observations outside the reconciliation

- `docker-compose.yml` commits a literal PostgreSQL password. Move it to `.env`.
- `.env.example` points `DATABASE_URL` at local Docker but `DIRECT_URL` at Neon.
- Planning workspace housekeeping is done in v0.3.0: §14 no longer states approval; `TASKS.json` regenerated (41 tasks); `TASKS.schema.json` still absent (GAP-019).
