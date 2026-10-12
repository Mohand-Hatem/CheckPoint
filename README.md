# 📍 CheckPoint

> **Enterprise Attendance, Gamified Points, and Incentive Payroll Fund Management System.**

CheckPoint is a production-grade full-stack platform that modernizes workplace attendance and incentive compensation. It combines anti-spoofing attendance tracking (GPS geofencing + dynamic rotating QR kiosk) with a point-based gamification engine that maps employee performance directly to monthly profit-sharing and incentive payroll distribution.

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

### 3. Database Migration & Seeding
Synchronize models with Neon PostgreSQL and seed initial roles and settings:
```bash
npx prisma db push
npx prisma db seed
```
Default credentials seeded:
- **Email**: `admin@checkpoint.local`
- **Password**: `AdminPassword123!`

### 4. Running the API
```bash
npm run start:dev
```
API runs on `http://localhost:4000/api`.

### 5. Running Automated Verification Tests
```bash
npm run test:all
```
Runs 17 end-to-end assertions verifying:
1. `test:auth` — Password verification, token rotation, theft detection, logout.
2. `test:rbac` — Unauthenticated rejection, `@CurrentUser`, 403 Forbidden, 429 login throttling.
3. `test:users` — User creation, paginated search, 1st-of-month salary rules, deactivation session purge.

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
- [`AGENTS.md`](file:///c:/Users/Mohand/Documents/GitHub/CheckPoint/AGENTS.md) — Guidelines for AI agents and engineering contributors.

---

## 📄 License
UNLICENSED — Private repository for CheckPoint development team.
