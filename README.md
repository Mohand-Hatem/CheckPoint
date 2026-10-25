# 📍 CheckPoint

> **Enterprise Attendance, Gamified Points, and Incentive Payroll Fund Management System.**

CheckPoint is a production-grade full-stack platform that modernizes workplace attendance and incentive compensation. It combines anti-spoofing attendance tracking (GPS geofencing + dynamic rotating QR kiosk) with a point-based gamification engine that maps employee performance directly to monthly profit-sharing and incentive payroll distribution.

---

## 🗺️ Project Roadmap & Current Progress Dashboard

The full project is structured across **9 Phases** consisting of **47 Granular Engineering Steps**:

```mermaid
flowchart LR
  P0["Phase 0: Setup ✅"] --> P1["Phase 1: Foundation 🟡"]
  P1 --> P2["Phase 2: Schedules ⏳"]
  P2 --> P3["Phase 3: Attendance ⏳"]
  P3 --> P4["Phase 4: Points ⏳"]
  P4 --> P5["Phase 5: Leaves ⏳"]
  P5 --> P6["Phase 6: Payroll ⏳"]
  P6 --> P7["Phase 7: Payouts ⏳"]
  P7 --> P8["Phase 8: Deploy ⏳"]
```

### Milestone Status: Phase 0 & Phase 1 (Steps 1.1–1.4) 100% COMPLETE 🎉

| Phase | Steps | Focus & Scope | Owner | Status |
| :--- | :---: | :--- | :--- | :---: |
| **Phase 0: Business Decisions & Workspace** | **4 steps** | Multi-client monorepo structure, legal decisions, security policies, and seed data. | Lead Dev (User) | **COMPLETED ✅** |
| ↳ *Step 0.1* | - | NestJS expert skill and monorepo scaffolding (`apps/api`, `web`, `mobile`) | Lead Dev | **COMPLETED ✅** |
| ↳ *Step 0.2* | - | Root `.gitignore` and `.env` credentials setup | Lead Dev | **COMPLETED ✅** |
| ↳ *Step 0.3* | - | Security policies (Argon2id, 15m JWT, 30d refresh family rotation, throttling) | Lead Dev | **COMPLETED ✅** |
| ↳ *Step 0.4* | - | System rules & seed data specifications | Lead Dev | **COMPLETED ✅** |
| **Phase 1: Foundation (Backend, Web & Mobile)** | **8 steps** | Modular monolith foundation, database schema, secure authentication, and RBAC. | Lead Dev / Team | **IN PROGRESS 🟡** |
| ↳ *Step 1.1* | - | Prisma schema, Neon PostgreSQL sync & initial database seeding | Lead Dev | **COMPLETED ✅** |
| ↳ *Step 1.2* | - | `AuthService`: Login, JWT signing, refresh rotation & real-time reuse theft detection | Lead Dev | **COMPLETED ✅** |
| ↳ *Step 1.3* | - | Global `JwtAuthGuard` (default-deny), `@RequirePermission` RBAC & 429 login throttling | Lead Dev | **COMPLETED ✅** |
| ↳ *Step 1.4* | - | Users CRUD, 1st-of-month versioned salaries & deactivation session purging | Lead Dev | **COMPLETED ✅** |
| ↳ *Step 1.5* | - | Audit interceptor, system settings service & injectable clock provider | Lead Dev / TM 2 | **UPCOMING ⏳** |
| ↳ *Step 1.6* | - | Dockerfile, Docker Compose & local multi-container orchestration | Teammate 3 (Asmaa) | **UPCOMING ⏳** |
| ↳ *Step 1.7* | - | Next.js 15 Admin Web Shell, token refresh interceptor & layout | Frontend Web | **UPCOMING ⏳** |
| ↳ *Step 1.8* | - | React Native Mobile App Shell, login screen & SecureStore tokens | Frontend Mobile | **UPCOMING ⏳** |
| **Phase 2: Schedules, Calendar & Locations** | **6 steps** | Geofence locations, shifts, Cairo/UTC timezone calendar & kiosk rotating QR tokens. | Teammate 2 | **UPCOMING ⏳** |
| **Phase 3: Attendance, GPS & Rotating QR** | **6 steps** | 2-step verification (GPS accuracy + kiosk camera scan), overtime units & auto-expiry. | Teammate 2 | **UPCOMING ⏳** |
| **Phase 4: Points & Offset Engine** | **6 steps** | Append-only point transactions, offset engine (Green/Red/Black), and absence sweeper. | Teammate 2 | **UPCOMING ⏳** |
| **Phase 5: Leave, Early Leave & Corrections** | **5 steps** | Leave requests, absence exemptions, admin corrections & in-app notifications. | Teammate 2 | **UPCOMING ⏳** |
| **Phase 6: Payroll Fund & Month Settlement** | **5 steps** | Month close transaction (EGP only), off-day-work pay, profit-sharing fund distribution. | Teammate 2 | **UPCOMING ⏳** |
| **Phase 7: Paymob Integration & Fund Payouts** | **4 steps** | Paymob payout gateway, encrypted account storage, webhook callbacks & idempotency. | Lead Dev / TM 2 | **UPCOMING ⏳** |
| **Phase 8: Hardening, Security & Deployment** | **3 steps** | Concurrency regression, production Docker deployment, security audit & live company pilot. | Full Team | **UPCOMING ⏳** |

---

## 🏗️ Architecture & Multi-Client Topology

CheckPoint is structured as a scalable monorepo comprising three specialized client and service tiers:

```
CheckPoint/
├── apps/
│   ├── api/        # [Backend] NestJS 11 Modular Monolith + Prisma + PostgreSQL 16 (Neon) + Redis
│   ├── web/        # [Web Frontend] Next.js 15 (Admin Management & Branch /kiosk QR Display)
│   └── mobile/     # [Mobile App] React Native (Expo) for Employees (GPS Check-in & QR Camera Scan)
├── docs/           # Comprehensive System Specifications & Sequence Diagrams (8 Modules)
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

---

## 🧪 Testing & CI/CD Quality Gates

CheckPoint enforces automated testing across three complementary layers:

### 1. Unit Tests (`npm run test:unit`)
Fast, isolated Jest unit tests mocking all external dependencies (Prisma, JwtService):
```bash
npm run test:unit
```
- Covers password hashing, user creation edge cases, 1st-of-month salary rules, and refresh token theft detection branching.

### 2. End-to-End Tests (`npm run test:e2e`)
Formal Jest + Supertest E2E tests verifying real HTTP requests against the NestJS application instance:
```bash
npm run test:e2e
```
- Tests live login authentication, `@CurrentUser` profile extraction, token rotation, family theft detection rejection, user creation, and 1st-of-month salary enforcement.

### 3. Comprehensive Verification Scripts (`npm run test:all`)
Runs the full suite of end-to-end regression scripts:
```bash
npm run test:all
```

### 4. GitHub Actions CI Pipeline (`.github/workflows/ci.yml`)
Every push and pull request to `main` runs an automated quality gate:
1. `npm ci` (clean dependency installation)
2. `npx prisma generate` (Prisma client generation)
3. `npx tsc --noEmit` (strict TypeScript typechecking)
4. `npm run build` (NestJS production compilation)
5. `npm run test:unit` (Jest unit test suite)

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
API runs on `http://localhost:4000/api`.

---

## 📚 Documentation Index

The repository contains complete specifications for the entire system lifecycle:
- [`01-PROJECT_BRIEF.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/docs/01-PROJECT_BRIEF.md) — High-level problem, solution, and MVP scope.
- [`02-PRD.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/docs/02-PRD.md) — Detailed functional requirements & user stories.
- [`03-TECH_STACK.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/docs/03-TECH_STACK.md) — Architectural rationale & technical selections.
- [`04-ARCHITECTURE.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/docs/04-ARCHITECTURE.md) — Multi-client data flow and module diagrams.
- [`05-SYSTEM_DESIGN.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/docs/05-SYSTEM_DESIGN.md) — Deep-dive state machines, algorithms, and policies.
- [`06-ROADMAP.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/docs/06-ROADMAP.md) — 9 phases and 47 granular engineering steps.
- [`07-SEQUENCE_DIAGRAMS.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/docs/07-SEQUENCE_DIAGRAMS.md) — Sequence diagrams for Auth, QR check-in, and Payroll.
- [`08-DATABASE_SCHEMA.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/docs/08-DATABASE_SCHEMA.md) — Complete relational schema & indexing strategy.
- [`09-DECISION_LOG.md`](docs/09-DECISION_LOG.md) — Reconciliation of the planning spec and these docs: confirmed decisions, conflicts, REQ-to-FR traceability, open questions.
- [`10-API_TESTING_GUIDE.md`](docs/10-API_TESTING_GUIDE.md) — End-to-end walkthrough of every route with real request and response bodies. Interactive docs at `/api/docs`; import `docs/api/openapi.json` into Apidog or Postman.
- [`AGENTS.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/AGENTS.md) — Guidelines for AI agents and engineering contributors.

---

## 📄 License
UNLICENSED — Private repository for CheckPoint development team.
