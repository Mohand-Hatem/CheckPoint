# CheckPoint - Agent & Engineering Guidelines

## Team Division & Ownership
- **User (Lead Developer)**: Authentication & Authorization (Phase 0 through Phase 1 Step 1.4).
- **Teammate 2**: Business domain database models (Attendance, Leaves, Points, Payroll Fund).
- **Teammate 3 (Asmaa)**: Dockerfile & Docker Compose configurations.
- *Strict Scope Discipline*: Do NOT create Dockerfiles or business domain tables while working on the Auth scope.

## Core Rules & Policies

### 1. Pedagogical Protocol (Mandatory on Every Step)
- Explain **What**, **How**, and **Why & Benefit** before coding.
- Pause for credentials / `.env` when needed.
- **Wait for explicit user approval** before executing code changes.

### 2. NestJS Architecture Standards
- Follow `.agent/skills/nestjs-expert/SKILL.md`.
- Adhere to NestJS module architecture, Dependency Injection, validation pipes, and custom guards.
- Implement atomic token rotation with family reuse theft detection for refresh tokens.

### 3. Ponytail - Lazy Senior Dev Mode
- The smallest complete change that solves the task wins.
- Zero unnecessary boilerplate, abstractions, or "for later" features.
- Keep values in the format platform provides. Deletion beats addition.
- Always conclude responses with: what was skipped / not checked, and any risk the user must know.

### 4. Strict GitHub Remote Policy
- NEVER interact with, access, modify, query, or execute commands affecting GitHub account or remote repositories without explicit user instruction.
- Strictly includes `git push`, `git pull`, `git fetch`, GitHub APIs, or GitHub CLI.
- All git operations remain local unless explicitly commanded by the user.

### 5. Frontend Design Review Protocol
- When starting frontend tasks (Web / Mobile), MUST pause for UI/UX review (`DESIGN.md`, `/design-taste-frontend`, `/ui-ux-pro-max`, TypeUI MCP, Playwright) before writing component code.

## Commands
| Task | Directory | Command |
|------|-----------|---------|
| Start API (Dev) | `apps/api` | `npm run start:dev` |
| Build API | `apps/api` | `npm run build` |
| Prisma Sync | `apps/api` | `npx prisma db push` |
| Prisma Generate | `apps/api` | `npx prisma generate` |
| Prisma Seed | `apps/api` | `npx prisma db seed` |

## Documentation References
| Subject | File |
|---------|------|
| Project Brief & Overview | `docs/01-PROJECT_BRIEF.md` |
| Product Requirements (PRD) | `docs/02-PRD.md` |
| Tech Stack & Rationale | `docs/03-TECH_STACK.md` |
| System Architecture | `docs/04-ARCHITECTURE.md` |
| Database Schema (Full) | `docs/08-DATABASE_SCHEMA.md` |
| Roadmap & Steps | `docs/06-ROADMAP.md` |
| NestJS Expert Guidelines | `.agent/skills/nestjs-expert/SKILL.md` |
