# 03 — Tech Stack

| Field | Value |
|---|---|
| **Version** | 3.0 |
| **Status** | Final draft — implementation-ready |
| **Last Updated** | 2026-10-08 |
| **Source of Truth** | The finalization prompt ("SoT") overrides older documents. Default stack per SoT §24: Modular Monolith + NestJS + PostgreSQL + Prisma + Redis/BullMQ where useful. |

Selection rule: a technology is here only if it solves a problem this system actually has.

---

## Backend — NestJS (TypeScript, Node LTS)
- **Choice:** NestJS with modules mirroring the business modules.
- **Why:** Modules, DI, guards and interceptors map directly to the layered design (Controller → Service → Repository) and to the RBAC guard; TypeScript types protect money/rules code.
- **Problem solved:** Keeps 15 modules separated inside one deployable; makes the injectable `Clock`, payment provider interface and permission guards natural.
- **Alternatives not needed now:** Express/Fastify alone (we would rebuild DI/guards); microservices (consistency between points, payroll and fund is far easier in one DB transaction).

## Web Frontend — Next.js (App Router, TypeScript, Tailwind CSS)
- **Choice:** Next.js for Admin web application and Branch Kiosk screen.
- **Why:** Fast rendering, structured App Router layouts, easy integration with TanStack Query, and first-class component styling for admin tables, review queues, and payroll screens.
- **Routes:** `/admin/*` for admin management screens; `/kiosk` for branch full-screen rotating HMAC QR display.
- **Supporting libs:** `@tanstack/react-query`, Tailwind CSS, `qrcode.react`, auto-generated OpenAPI client.

## Mobile App — React Native (Expo, TypeScript)
- **Choice:** React Native with Expo for the Employee mobile application (iOS & Android).
- **Why:** Native hardware integration: OS-level GPS accuracy (`expo-location`), camera QR scanner (`expo-camera`), and secure token persistence (`expo-secure-store`). Shares TypeScript types and API contracts with the web admin.
- **Problem solved:** Reliable device-native attendance check-in without mobile browser permission friction.
- **Supporting libs:** Expo Router, `expo-location`, `expo-camera`, `expo-secure-store`, `@tanstack/react-query`, auto-generated OpenAPI client.

## Database — PostgreSQL 16
- **Choice:** Single PostgreSQL 16 instance (managed or Docker volume with backups). Environments: local development uses the `postgres:16-alpine` service in `docker-compose.yml` (`DATABASE_URL` → `localhost:5432`); shared dev/staging may use Neon (managed PostgreSQL 16, pooled `DATABASE_URL` + direct `DIRECT_URL` for migrations); production hosting is DN-19. `DATABASE_URL` and `DIRECT_URL` must point at the **same** database in any one environment.
- **Why:** ACID transactions, `SELECT … FOR UPDATE`, partial unique indexes, exclusion constraints, triggers, `NUMERIC`, `JSONB`.
- **Problem solved:** Source of truth for points, fund, payroll; DB-level invariants (one attendance/day, one reversal per point, unique payout key, locked-month trigger).
- **Alternatives not needed now:** MongoDB/DynamoDB (weak relational constraints for money); a separate ledger DB (premature).

## ORM — Prisma (with hand-written SQL migrations where needed)
- **Choice:** Prisma Client for typed CRUD; raw SQL (`$queryRaw`, migration `.sql`) for `FOR UPDATE`, partial unique indexes, exclusion constraint, triggers, derived-state views.
- **Why:** Type safety and migration workflow; raw SQL escape hatch is explicit and contained in repositories.
- **Problem solved:** Prevents ad-hoc SQL drift while allowing the Postgres features Prisma's schema language cannot express.
- **Alternatives not needed now:** TypeORM (heavier, weaker typing), Kysely/Drizzle (would also work; no reason to switch).

## Authentication — JWT access + rotating refresh, Passport, argon2id
- **Choice:** Access JWT (15 min); opaque refresh token (random 256-bit, stored as hash in `refresh_tokens`, rotated on every use, reuse of an old token revokes the family); `argon2` (argon2id) for passwords.
- **Why:** Stateless API calls with revocable sessions; argon2id is the current default recommendation.
- **Problem solved:** Stolen refresh tokens are detected; disabled users lose access at next refresh (≤ 15 min for access tokens; permission check also reads `users.active` on refresh).
- **Two transports, one core (decided 2026-10-26):** the same tokens and rules serve both clients. **Mobile** (and Swagger, Apidog, curl) sends `Authorization: Bearer <accessToken>` and keeps tokens in `expo-secure-store`. **Web** (Next.js) asks for cookie mode with the request header `X-Auth-Mode: cookie`: the API then sets `HttpOnly` cookies and keeps the tokens out of the response body, so browser JavaScript can never read them. When both a header and a cookie arrive, the header wins.
- **Cookie rules:** access cookie `cp_access` (`Path=/api`, same lifetime as the JWT) and refresh cookie `cp_refresh` (`Path=/api/auth`, 30 days), both `HttpOnly`, `SameSite=Lax`, `Secure` in production. A request authenticated by cookie that changes data (POST, PATCH, PUT, DELETE) must also send `X-CSRF-Token`, a value the API returns at login, at refresh and on `GET /auth/me`. Requests authenticated by the header are exempt, because a browser cannot attach that header to a cross-site request by itself. CORS allows only the origins listed in `CORS_ORIGINS`, with credentials.
- **Alternatives not needed now:** server-side session store (the token core already gives revocable sessions); OAuth/SSO (no IdP requirement).

## Validation — class-validator + class-transformer (DTOs)
- **Choice:** DTO classes on every endpoint; global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`).
- **Why:** Native NestJS integration with Swagger decorators.
- **Problem solved:** Rejects malformed lat/lng, amounts, dates before reaching services; domain rules are enforced separately in services.
- **Alternatives not needed now:** Zod/Joi (would duplicate Swagger schema work).

## Redis — 7.x
- **Choice:** Redis for BullMQ storage, login/rate-limit counters, and the cached Paymob bearer token.
- **Why:** Required by BullMQ; cheap counters.
- **Problem solved:** Background scheduling and throttling.
- **Hard rule:** Redis is **never** a source of truth for points, fund, payroll or payout state (SoT §20). Persistence (AOF) is enabled, but correctness never depends on it.
- **Alternatives not needed now:** Memcached (no queue); a Postgres-only queue (pg-boss) is viable but BullMQ is already the SoT-approved default.

## Queue / Jobs — BullMQ
- **Choice:** BullMQ queues: `attendance-sweeper` (repeatable, 1/min), `outbox-relay` (repeatable, ~every 5–10 s), `payout` (send / inquire jobs).
- **Why:** Repeatable jobs, retries with exponential backoff, failed-job set, safe with more than one instance.
- **Problem solved:** Timed absence/verification handling and reliable payout processing. The **transactional outbox** (table `outbox_events`) guarantees a committed payout always results in a job, even if Redis was down at commit time.
- **Alternatives not needed now:** Kafka/RabbitMQ (no streaming or multi-service routing), in-process cron only (loses retries/visibility).

## Time — Luxon
- **Choice:** Luxon with zone `Africa/Cairo` for business computation; storage in `timestamptz` (UTC).
- **Why:** Correct zone/DST handling and explicit zone objects.
- **Problem solved:** Window boundaries, `work_date`, month boundaries independent of server timezone; tests inject a fake `Clock`.
- **Alternatives not needed now:** date-fns-tz/dayjs (less explicit zone handling), `Date` (error-prone).

## Money Handling — PostgreSQL `NUMERIC(14,2)` + `decimal.js` (Prisma `Decimal`)
- **Choice:** All amounts `NUMERIC`; arithmetic via Decimal; rounding `ROUND_HALF_UP` to 2 decimals applied once per line at defined points (documented in System Design §9). EGP only: no FX rate, no currency conversion (CONFIRMED). Integer-piaster storage was proposed by the planning spec and is not adopted (DN-23).
- **Why:** Floats are unsafe for money.
- **Problem solved:** Exact payroll and fund totals; golden cases reproducible to the piaster/cent.
- **Alternatives not needed now:** Integer minor units (also valid; NUMERIC is simpler to read/audit here).

## Testing — Jest, Supertest, Testcontainers (PostgreSQL + Redis)
- **Choice:** Unit (pure rule functions), integration (HTTP + real DB via Testcontainers), concurrency tests (parallel requests against a real DB), table-driven golden cases.
- **Why:** The bugs that matter are transactional and concurrent; mocks cannot find them.
- **Problem solved:** Verifies invariants (locks, unique indexes, triggers) that only a real PostgreSQL enforces.
- **Alternatives not needed now:** E2E browser suites beyond a smoke test; load-testing tools (optional later).

## API Documentation — `@nestjs/swagger` (OpenAPI 3)
- **Choice:** Generated spec at `/api/docs`, versioned URL prefix `/api/v1`.
- **Why/Problem solved:** Contract for the frontend; generated client types.
- **Alternatives not needed now:** Hand-written docs (drift).

## Logging & Monitoring — Pino (`nestjs-pino`), health endpoints
- **Choice:** JSON logs with request ID, redaction of tokens/accounts/passwords; `/health/live`, `/health/ready` (DB + Redis).
- **Why/Problem solved:** Traceable support cases and payout debugging without leaking secrets.
- **Later (optional):** Sentry for errors; Prometheus metrics. Not required for MVP correctness.

## Payments — Paymob Payouts via `PayoutProvider` interface
- **Choice:** `PaymobProvider` adapter with `send()` and `inquire()`; signed webhook controller; manual provider path.
- **Why:** SoT requires Paymob readiness without an enterprise payment platform. Interface keeps tests in a fake provider.
- **Alternatives not needed now:** Multi-provider routing; a second provider.

## Deployment — Docker + GitHub Actions
- **Choice:** Images for `api` (also runs workers via env flag), PostgreSQL, Redis, reverse proxy (TLS), static frontend; Docker Compose on one host (or managed PostgreSQL/Redis). CI: lint, unit, integration, build, Prisma migration check.
- **Why/Problem solved:** Reproducible deploys for a single-company system; daily PostgreSQL backups; secrets via environment/secret store, validated at boot.
- **Alternatives not needed now:** Kubernetes (operational cost > benefit). Hosting provider **DN-19** (hosting) is decided in Phase 0.

## Libraries explicitly NOT adopted
Kafka/RabbitMQ clients, GraphQL, CQRS/event-sourcing frameworks, NFC/Wi-Fi/biometric/attestation SDKs, feature-flag platforms, ORM-level soft-delete plugins.
