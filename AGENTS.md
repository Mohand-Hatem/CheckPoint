# CheckPoint - Agent & Engineering Guidelines

## Team Division & Ownership
- **User (Lead Developer)**: Authentication & Authorization (Phase 0 through Phase 1 Step 1.4).
- **Teammate 2**: Business domain database models (Attendance, Leaves, Points, Payroll Fund).
- **Teammate 3 (Asmaa)**: Dockerfile & Docker Compose configurations.
- *Strict Scope Discipline*: Do NOT create Dockerfiles or business domain tables while working on the Auth scope.

---

## Core Project Rules (Mandatory)

### Rule 1: Backend NestJS Standards & Expert Skill
- Backend development MUST adhere to NestJS best practices.
- The NestJS expert skill is installed at `.agent/skills/nestjs-expert/SKILL.md`:
  ```bash
  mkdir -p .agent/skills/nestjs-expert && curl -L -o skill.zip "https://mcp.directory/api/skills/download/983" && unzip -o skill.zip -d .agent/skills/nestjs-expert && rm skill.zip
  ```
- Follow NestJS module architecture, Dependency Injection, validation pipes, custom guards, and secure token rotation with reuse theft detection.

### Rule 2: Frontend Design & UI/UX Protocol
- When starting frontend tasks (Web / Mobile screens, color palette, design tokens, `DESIGN.md`), agents MUST STOP and pause for human review before generating any component code.
- Required frontend design toolchain:
  - Skills: `/impeccable`, `/design-taste-frontend`, `/ui-ux-pro-max`
  - MCP Servers: TypeUI (`https://mcp.typeui.sh/mcp`), Playwright (`npx @playwright/mcp@latest`), and Next DevTools (`npx add-mcp next-devtools-mcp@latest`).
- Review and align on typography, layout hierarchy, and micro-interactions before implementation.

### Rule 3: Pedagogical Step Protocol, Approvals, & Ponytail Execution
- **Division**: The whole project is divided into granular phases, and each phase into granular steps.
- **Before Every Step**: The agent must explain:
  1. **What** this step is going to do.
  2. **How** it will be implemented.
  3. **Why & Benefit** (why this approach is better than alternatives, fostering real engineering learning).
- **Configuration & Secret Pauses**: If a step requires external credentials or configuration (e.g., Neon DB, Redis, JWT secrets, Expo keys), the agent MUST STOP and instruct the user to obtain keys and place them in `.env`.
- **Explicit Approval Required**: The agent MUST NOT write or execute code until the user has reviewed and explicitly approved the step.
- **Concise Execution via `/ponytail`**: Once approved, execute using ponytail lazy senior dev mode:
  - The smallest complete change that solves the task wins.
  - No unnecessary abstractions, wrappers, or bloat.
  - Keep explanations concise.
  - Conclude responses with: what was skipped / not checked, and any risks the user must know.

### Rule 4: Mandatory Skills (apply to the whole project)
- `using-superpowers` and `using-agent-skills`: check for an applicable skill before any task. Surface assumptions, enforce simplicity, keep scope tight, and verify before calling work done.
- `graphify`: the knowledge graph lives in `graphify-out/`. For codebase questions run `graphify query "<question>"` first. After code changes run `graphify update .`.
- `ponytail`: smallest complete change, and end each reply with what was skipped and the risks.
- `humanizer`: use it on prose we write for people (README, docs, PR descriptions, commit messages).
- Precedence: Rules 1 to 3 and the GitHub policy win over any skill. A skill never replaces the explain-then-approve step in Rule 3.

### Rule 5: Requirements flow in one direction
- Business rules (what and why) live in the planning spec (local `planning/` workspace, its own `AGENTS.md`); technical design (how) lives in `docs/`; code implements `docs/`.
- A business change starts in the spec: new version, review, and a human approval recorded in `planning/docs/planning/SPEC_APPROVAL.md` (agents never edit that file). Only then update `docs/`, then code. Never change a business rule in `docs/` or code first.
- `docs/09-DECISION_LOG.md` is the shared record of what the spec decided and how each `REQ-*` maps to `FR-*`. Tests should name the `TEST-xxx` / `AC-REQ-xxx` they prove.

---

### Strict GitHub Policy
- NEVER interact with, access, modify, query, or execute commands affecting GitHub accounts or remote repositories without explicit, direct user instructions.
- Never run remote commands (`git push`, `git pull`, `git fetch`, GitHub CLI) unless explicitly commanded for that specific action.
- All git operations remain local by default.

---

## Commands
| Task | Directory | Command |
|------|-----------|---------|
| Start API (Dev) | `apps/api` | `npm run start:dev` |
| Build API | `apps/api` | `npm run build` |
| Prisma Sync | `apps/api` | `npx prisma db push` |
| Prisma Generate | `apps/api` | `npx prisma generate` |
| Prisma Seed | `apps/api` | `npx prisma db seed` |

---

## Documentation References
| Subject | File |
|---------|------|
| Project Brief & Overview | `docs/01-PROJECT_BRIEF.md` |
| Product Requirements (PRD) | `docs/02-PRD.md` |
| Tech Stack & Rationale | `docs/03-TECH_STACK.md` |
| System Architecture | `docs/04-ARCHITECTURE.md` |
| System Design & Flow | `docs/05-SYSTEM_DESIGN.md` |
| Roadmap & Steps | `docs/06-ROADMAP.md` |
| Sequence Diagrams | `docs/07-SEQUENCE_DIAGRAMS.md` |
| Database Schema (Full) | `docs/08-DATABASE_SCHEMA.md` |
| Decision Log & REQ↔FR Traceability | `docs/09-DECISION_LOG.md` |
| NestJS Expert Guidelines | `.agent/skills/nestjs-expert/SKILL.md` |
