# 01 — Project Brief

| Field | Value |
|---|---|
| **Version** | 3.0 (supersedes Design Document v2) |
| **Status** | Final draft — implementation-ready. Open items are marked `DECISION NEEDED (DN-xx)` and are resolved in Phase 0 (see `06-ROADMAP.md`). |
| **Last Updated** | 2026-10-08 |
| **Source of Truth** | The finalization prompt ("**SoT**") is the highest-priority source. Where this set conflicts with older files (`Design Document v2.md`, `attendance-system-design.html`, the PDF), **SoT wins**. Older files are reference only. |

---

## 1. Problem

The company has no reliable, explainable way to (a) record who actually came to work and when, (b) turn punctuality and overtime into a simple incentive, and (c) turn that incentive into money (monthly payroll effects and a withdrawable fund). Manual sheets are slow, disputed, and easy to falsify; location-only check-in is easy to spoof.

## 2. Target Users

| User | Need |
|---|---|
| **Employee** | Check in/out quickly, understand every point and its money impact, request leave / early leave, see and withdraw fund balance. |
| **Admin** (HR/management role in the current version) | Control employees, schedules, attendance, leave, points, payroll month close, fund and payouts, with a full audit trail. |

## 3. Product Goal

> A reliable, explainable, secure **Attendance + Points + Incentive/Payroll-Fund** system for **one company**.

Priority order (SoT §41): **Correctness > Money Integrity > Attendance Integrity > Security > Auditability > Simplicity > Future Extensibility.**

## 4. Core Value

1. **Trustworthy attendance** — GPS + geofence + short-lived QR; server time only.
2. **Simple, visible rules** — exactly one attendance point per day: `GREEN | WHITE | RED | BLACK`.
3. **Fair offsetting** — Greens cancel Reds (1:1) and Blacks (5:1); a Green is never paid twice.
4. **Money integrity** — append-only point and fund ledgers; PostgreSQL is the only source of truth.

## 5. Scope

### MVP scope
- Company registration with the registering user as company owner/admin, plus employee invitations and company-scoped data.
- Auth (JWT + rotating refresh), two active roles `ADMIN`, `EMPLOYEE`, on a small RBAC foundation.
- Client apps: React Native mobile app (Employee attendance, GPS geofencing, QR scanner, points, leaves, withdrawals) + Next.js web app (Admin dashboard/management, review queues, and `/kiosk` rotating QR display).
- Employees, salaries (versioned), locations/geofences, work schedules + assignments, weekly off days, holidays, off-day-work exceptions (admin-granted).
- Check-in (GPS → geofence → QR within 15 min), check-out, overtime Greens, daily absence job (Black).
- Append-only point ledger, offset engine, admin add/reverse points, manual attendance correction.
- Leave (`ANNUAL | SICK | UNPAID`, full days), early leave (request → approve/reject).
- Payroll preview and month close/lock, payroll adjustments, fund ledger.
- Fund withdrawal through Paymob (adapter, inquiry, signed webhook, manual fallback), outbox for payouts.
- Audit log, in-app notifications, Swagger, Docker deployment.

### Later
- Employee-initiated off-day-work requests; push notifications (FCM); self-service password reset; reports/exports; multiple payout methods; salary payouts through Paymob; Sentry/metrics dashboards.

### Future
- `MANAGER`, `HR`, `FINANCE` roles; rotating/split shifts; half-day leave.

## 6. Explicit Out of Scope (current version)

Microservices, Kafka/RabbitMQ, distributed event architecture, complex RBAC matrix, full accounting/ERP, leave accrual/carry-over engine, complex scheduling engine, NFC / Wi-Fi / biometrics / Play Integrity / AI fraud detection, social insurance & income tax computation, cursor pagination (unless proven necessary), audit-log partitioning (unless volume requires).

## 7. System Boundaries

```text
Inside the system                         Outside the system
-------------------------------------     -------------------------------------
Attendance, points, offsets               Salary disbursement of net payroll (paid by the company's
Leave & early-leave workflows               existing bank process in MVP)
Payroll calculation & month lock          Tax / social insurance
Fund ledger & withdrawals                 Legal decision on deductions (Phase 0)
Paymob payout integration                 Paymob's own settlement and KYC
```

## 8. Main Actors

| Actor | Description |
|---|---|
| Employee | Authenticated end user, sees only own data. |
| Admin | Authenticated, broad authority; every mutation is audited. |
| System (jobs) | Absence/verification sweeper, outbox relay, payout worker/inquiry. |
| Paymob | External payout provider (API + signed webhooks). |

## 9. High-Level Business Concept

```text
Check-in time (Cairo)         Point (exactly one per day)     Money meaning
08:00–08:59  EARLY     ──►    GREEN   (+1)               ──►  1 unused Green = 1 USD (Fund)
09:00–09:59  NORMAL    ──►    WHITE   (+1, visibility only)   none
10:00–11:59  LATE      ──►    RED     (+1)               ──►  potential deduction 250 EGP
12:00+ no attendance/leave ─► BLACK   (+1)               ──►  potential deduction 1000 EGP

Overtime: floor(minutes after shift end / 60) extra GREENs on check-out.

GREEN lifecycle:   1 GREEN cancels 1 RED (oldest first)
                   5 GREEN cancel 1 BLACK (atomic, no partial)
                   remaining GREEN at Month Close → Fund credit (never paid twice)
```

Deductions from salary are **configurable and OFF by default** until the company's legal review (DN-01).
