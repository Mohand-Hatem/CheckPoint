# 📍 CheckPoint

> **Enterprise Attendance, Gamified Points, and Incentive Payroll Fund Management System.**

CheckPoint is a production-grade full-stack platform that modernizes workplace attendance and incentive compensation. It combines anti-spoofing attendance tracking (GPS geofencing + dynamic rotating QR kiosk) with a point-based gamification engine that maps employee performance directly to monthly profit-sharing and incentive payroll distribution.

---

## 🗺️ Where the project stands (2026-11-02)

Only the **backend API** is built so far. `apps/web` and `apps/mobile` are still empty. The detailed done / not-done list per phase is in [`docs/06-ROADMAP.md`](docs/06-ROADMAP.md#status-2026-11-02-main-at-pr-10).

```mermaid
flowchart LR
  P0["0 Decisions 🟡"] --> P1["1 Foundation 🟡"]
  P1 --> P2["2 Schedules 🟡"]
  P2 --> P3["3 Attendance 🟡"]
  P3 --> P4["4 Points 🟡"]
  P4 --> P5["5 Leave & corrections 🟡"]
  P5 --> P6["6 Payroll ⏳"]
  P6 --> P7["7 Paymob ⏳"]
  P7 --> P8["8 Pilot ⏳"]
```

### What works today (API)

| Area | What you can do |
| :--- | :--- |
| **Auth** | Sign in, rotating refresh tokens with theft detection, sign out, cookie sign-in for the web app (with CSRF), forced password change, login throttling |
| **Companies** | Several isolated companies; a company and its first Admin are created by a provisioning command, never a public endpoint |
| **People** | Admin creates users directly or **invites** them (the link is also emailed when SMTP is set); list, edit, activate and deactivate employees; salary versions from the 1st of a month |
| **Schedules** | Company timezone policy, shifts with dated versions and weekdays, employee shift assignments with history |
| **Points** | Point values in EGP from a date; add and reverse points with a mandatory reason; the ledger is append-only |
| **Attendance** | Admin corrections (set check-in, set check-out, exempt) that reverse and re-award the day's points and overtime Greens |
| **Audit** | Every admin change is recorded with actor, target and before/after; the log is append-only and readable by the Admin |

### Coming next

1. Phase 2 remainder: locations and geofences, rotating QR tokens, holidays, off-day work offers.
2. Phase 3: the employee check-in API (GPS, then QR), built on the existing attendance rules.
3. Phase 4: the offset engine and the daily absence job (BLACK at 12:00).
4. Phase 5: leave and early-leave requests.
5. Web admin and mobile app shells (can start at any time).

---

## 🏗️ Architecture & Multi-Client Topology

CheckPoint is structured as a scalable monorepo comprising three specialized client and service tiers:

```
CheckPoint/
├── apps/
│   ├── api/        # [Backend] NestJS 11 Modular Monolith + Prisma + PostgreSQL 16 (Neon) + Redis
│   ├── web/        # [Web Frontend] Next.js 15 (Admin Management & Branch /kiosk QR Display) — not started
│   └── mobile/     # [Mobile App] React Native (Expo) for Employees (GPS Check-in & QR Camera Scan) — not started
├── docs/           # Specifications, decision log, API guide and docs/api/openapi.json
├── AGENTS.md       # Engineering Rules, NestJS Standards & Team Division Guidelines
└── .gitignore      # Secrets & Environment Policy
```

### Tech Stack Breakdown
| Tier | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend API** | NestJS 11, TypeScript, Express | Modular monolith service layer with DI and validation pipes. |
| **Database & ORM** | PostgreSQL 16 (Neon Cloud), Prisma 6 | Serverless relational storage with connection pooling & direct migrations. |
| **Logging & Metrics** | Pino (`nestjs-pino`, `pino-pretty`) | High-performance asynchronous structured logging with sensitive field redaction. |
| **Cache & Queue** | Redis, BullMQ | Asynchronous event processing, job workers, and rate limiting. |
| **Security & Auth** | Argon2id, Passport-JWT, Crypto SHA-256 | Single-use rotating refresh tokens with family theft detection. |
| **Email** | `@nestjs-modules/mailer` 4.0.0 (Nodemailer) | Invitation emails over SMTP; printed to the console when SMTP is not set. |
| **Time** | Luxon | Shift windows in the company timezone (DST-safe), stored as UTC. |
| **API docs** | `@nestjs/swagger` | Swagger UI at `/api/docs`, committed `docs/api/openapi.json`. |
| **Admin & Kiosk Web** | Next.js 15 (App Router), Tailwind CSS | Administrative control panel and high-contrast rotating QR kiosk. |
| **Employee Mobile** | React Native (Expo Router) | Geofenced GPS check-in, camera scanner, points ledger, and leave requests. |

---

## 👥 Team Division & Roles

To ensure clean engineering separation and avoid git merge collisions:
- **Lead Developer (User)**: Authentication & Authorization (Phase 0 through Phase 1 Step 1.4: JWT, Refresh Rotation, RBAC, Users & Versioned Salaries).
- **Teammate 2**: Business Domain Database Models (Attendance, Leaves, Points, Payroll Fund).
- **Teammate 3 (Asmaa)**: Dockerfile, Docker Compose, and Container Orchestration.

---

## 🔐 Security & Authorization Highlights

- **Argon2id Hashing**: Memory-hard password hashing resistant to GPU/ASIC brute-force attacks.
- **Refresh Token Family Rotation (RFC 6819)**: Every token refresh issues a new token and revokes the old one. If an attacker presents an already-used token (theft scenario), the entire token family is immediately burned across all devices.
- **Zero Plaintext Stored Tokens**: Refresh tokens are stored strictly as SHA-256 hashes in Neon DB.
- **Fine-Grained RBAC**: Route handlers declare granular permissions (e.g. `@RequirePermission('users.write')`), validated by global guards adhering to a **default-deny** architecture.
- **Immediate Session Purge**: Deactivating an employee (`active: false`) instantly invalidates all active sessions.
- **Company Isolation**: The company always comes from the session. Another company's record answers 404, exactly like a missing one.
- **Hash-Only Invitations**: Invitation tokens are stored as SHA-256 hashes, expire after 7 days and work once, even under concurrent accepts.
- **Append-Only Records**: Database triggers reject UPDATE, DELETE and TRUNCATE on the audit log and the point ledger. Corrections are new compensating rows.

---

## 🧪 Testing & CI

Run these in `apps/api`:

```bash
npm run test:unit   # Jest unit tests, no database needed
npm run test:e2e    # HTTP end-to-end suites; needs a migrated PostgreSQL (see docs/10-API_TESTING_GUIDE.md)
```

- **Unit tests** cover auth and token theft, company scoping, invitations and email delivery, salary rules, shift windows and classification at every boundary second (including Egyptian summer time), overtime Greens, attendance corrections, and audit.
- **`swagger.spec.ts`** fails when a route has no summary, tag or success response, or when `docs/api/openapi.json` is stale. Fix it with `npm run docs:openapi`.

GitHub Actions (`.github/workflows/ci.yml`) runs two jobs on every pull request and push to `main`:
1. **Build, typecheck and unit tests:** `npm ci`, `prisma generate`, `tsc --noEmit`, `npm run build`, `npm run test:unit`.
2. **End-to-end on PostgreSQL:** a fresh PostgreSQL service, `prisma migrate deploy`, seed, then `npm run test:e2e`.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `v22.x` or higher
- **npm**: `v10.x` or higher
- **Neon PostgreSQL**: A free Neon serverless PostgreSQL project

### 1. Installation
Clone the repository and install backend dependencies:
```bash
git clone https://github.com/Mohand-Hatem/CheckPoint.git
cd CheckPoint/apps/api
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env` in `apps/api`:
```bash
cp .env.example .env
```
Fill in your Neon connection strings:
```env
PORT=4000
DATABASE_URL="postgresql://user:password@ep-pooler.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://user:password@ep-direct.neon.tech/neondb?sslmode=require"
JWT_ACCESS_SECRET="your-secure-random-access-secret"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_DAYS=30
CORS_ORIGINS="http://localhost:3000"   # browsers allowed to call the API (web app). Mobile and tools are not affected.
# Invitation email. Leave SMTP_HOST empty in development: mails are printed to the console.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="CheckPoint <no-reply@checkpoint.local>"
INVITE_URL_BASE=http://localhost:3000/invitations/accept   # web page that accepts invitations; the API appends ?token=...
```

### 3. Database Schema & Seeding
Apply the migrations (they also create the database-level rules and the append-only audit log) and seed:
```bash
npx prisma migrate deploy
npx prisma db seed
```
Changing the schema? Edit `prisma/schema.prisma`, run `npx prisma migrate dev --name <change>`, and commit the new folder in `prisma/migrations/`. **Never use `db push` on a shared database** (it skips the migrations and their rules).

> **Direction (2026-10-25):** the MVP is a **multi-company foundation, EGP only** (spec v0.4.0): companies are created by a provisioning command, employees join by invitation, and every company is isolated. Public self-service SaaS comes later. See `docs/09-DECISION_LOG.md`. To create a company and its first Admin, follow `docs/11-PROVISIONING_RUNBOOK.md`.

Do not use the development seed account in production. **Existing database from the old `db push` days?** Either rebuild it (`npx prisma migrate reset`, run by you in your own terminal: it deletes the data), or, if it already matches the schema and holds no rule-breaking rows, keep it with `npx prisma migrate resolve --applied 20261025000000_init` and then `npx prisma migrate deploy`. If a migration fails with a duplicate key, remove the duplicates, run `npx prisma migrate resolve --rolled-back <migration-name>`, and deploy again.

### 4. Running the API
```bash
npm run start:dev
```
API runs on `http://localhost:4000/api`. Swagger UI is at `http://localhost:4000/api/docs` (outside production).

---

## 📚 Documentation Index

The repository contains complete specifications for the entire system lifecycle:
- [`01-PROJECT_BRIEF.md`](docs/01-PROJECT_BRIEF.md) — High-level problem, solution, and MVP scope.
- [`02-PRD.md`](docs/02-PRD.md) — Detailed functional requirements & user stories.
- [`03-TECH_STACK.md`](docs/03-TECH_STACK.md) — Architectural rationale & technical selections.
- [`04-ARCHITECTURE.md`](docs/04-ARCHITECTURE.md) — Multi-client data flow and module diagrams.
- [`05-SYSTEM_DESIGN.md`](docs/05-SYSTEM_DESIGN.md) — Deep-dive state machines, algorithms, and policies.
- [`06-ROADMAP.md`](docs/06-ROADMAP.md) — The 9 phases, their Definition of Done, and the current done / not-done status.
- [`07-SEQUENCE_DIAGRAMS.md`](docs/07-SEQUENCE_DIAGRAMS.md) — Sequence diagrams for Auth, QR check-in, and Payroll.
- [`08-DATABASE_SCHEMA.md`](docs/08-DATABASE_SCHEMA.md) — Complete relational schema & indexing strategy.
- [`09-DECISION_LOG.md`](docs/09-DECISION_LOG.md) — Reconciliation of the planning spec and these docs: confirmed decisions, conflicts, REQ-to-FR traceability, open questions.
- [`10-API_TESTING_GUIDE.md`](docs/10-API_TESTING_GUIDE.md) — End-to-end walkthrough of every route with real request and response bodies. Interactive docs at `/api/docs`; import `docs/api/openapi.json` into Apidog or Postman.
- [`11-PROVISIONING_RUNBOOK.md`](docs/11-PROVISIONING_RUNBOOK.md) — How an operator creates a company and its first Admin.
- [`AGENTS.md`](AGENTS.md) — Guidelines for AI agents and engineering contributors.

---

## 📄 License
UNLICENSED — Private repository for CheckPoint development team.
