/**
 * Executable documentation: runs the real end-to-end cycle against a RUNNING API and writes
 * docs/10-API_TESTING_GUIDE.md from the real requests and responses. Fails if any step returns
 * an unexpected status, so it doubles as a smoke test.
 *
 *   1. docker compose up -d postgres ; npx prisma db push ; npx prisma db seed
 *   2. npm run start            (in another terminal)
 *   3. npm run docs:guide       (API_URL defaults to http://localhost:4000/api)
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { provisionCompany } from '../src/company/provision-company';

const BASE = process.env.API_URL || 'http://localhost:4000/api';
const ROOT = join(__dirname, '..', '..', '..');
const PASSWORD = 'Password123!';
const run = Date.now();

type Json = Record<string, any> | any[] | null;
interface Step {
  title: string;
  why: string;
  method: string;
  path: string;
  token?: string;
  body?: unknown;
  expect: number;
  note?: string;
}

const md: string[] = [];
let stepNo = 0;
const failures: string[] = [];

// Long secrets are shortened so the guide stays readable; values are still real.
function redact(value: any): any {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        ['accessToken', 'refreshToken', 'token'].includes(k) && typeof v === 'string' ? [k, `${v.slice(0, 18)}…(${v.length} chars)`] : [k, redact(v)],
      ),
    );
  }
  return value;
}

async function call(step: Step): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${step.path}`, {
    method: step.method,
    headers: {
      ...(step.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(step.token ? { Authorization: `Bearer ${step.token}` } : {}),
    },
    body: step.body !== undefined ? JSON.stringify(step.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  stepNo += 1;
  const ok = res.status === step.expect;
  if (!ok) failures.push(`Step ${stepNo} "${step.title}": expected ${step.expect}, got ${res.status} ${text.slice(0, 200)}`);

  md.push(`### Step ${stepNo}. ${step.title}`, '', step.why, '');
  md.push('**Request**', '', '```http', `${step.method} /api${step.path}`);
  if (step.token) md.push('Authorization: Bearer <accessToken>');
  if (step.body !== undefined) md.push('Content-Type: application/json', '', JSON.stringify(redact(step.body), null, 2));
  md.push('```', '', `**Response ${res.status}${ok ? '' : ' (UNEXPECTED)'}**`, '', '```json', JSON.stringify(redact(json), null, 2), '```', '');
  if (step.note) md.push(`> ${step.note}`, '');
  return { status: res.status, json };
}

function section(title: string, intro?: string) {
  md.push(`## ${title}`, '');
  if (intro) md.push(intro, '');
}

async function main() {
  const prisma = new PrismaClient();
  const a = { email: 'admin@checkpoint.local', password: 'AdminPassword123!' }; // development admin from the seed

  section('3. The cycle, step by step', 'Everything below was produced by really calling the API (values such as ids and dates differ on your machine). Tokens are shortened.');

  // ---------------------------------------------------------------- A. sign in
  md.push('### Part A: Sign in as an Admin', '');
  const login = await call({
    title: 'Sign in',
    why: 'The Admin trades email and password for two tokens. Use `accessToken` on every request (15 minutes). Keep `refreshToken` to get a new pair later (30 days, single-use).',
    method: 'POST', path: '/auth/login', body: a, expect: 200,
  });
  const admin = { access: login.json.accessToken as string, refresh: login.json.refreshToken as string };

  await call({
    title: 'Who am I?',
    why: 'Shows the claims inside the token: `companyId` is your company, and it comes from the token, never from anything you send.',
    method: 'GET', path: '/auth/me', token: admin.access, expect: 200,
  });
  await call({
    title: 'Check a permission',
    why: 'An ADMIN has `users.read`, so this succeeds. (An EMPLOYEE gets 403 in Part C.)',
    method: 'GET', path: '/auth/test-permission', token: admin.access, expect: 200,
  });

  // ---------------------------------------------------------------- B. employees
  md.push('### Part B: Manage employees (ADMIN)', '');
  const code = `GUIDE-${run}`;
  const sara = await call({
    title: 'Create an employee',
    why: 'Creates the login, the role link, the employee record and the first salary in one transaction, inside the Admin\'s company. Save the returned `id`.',
    method: 'POST', path: '/admin/users', token: admin.access, expect: 201,
    body: { email: `sara-${run}@acme.test`, fullName: 'Sara Ahmed', employeeCode: code, password: PASSWORD, roleCode: 'EMPLOYEE', initialSalary: 12000, phone: '+201001234567' },
  });
  const saraId = sara.json.id as string;

  await call({
    title: 'Search the list',
    why: 'Paginated and company-scoped. `search` matches email, name or employee code.',
    method: 'GET', path: `/admin/users?search=${code}&limit=5`, token: admin.access, expect: 200,
  });
  await call({
    title: 'Add a salary version (a raise)',
    why: 'Salaries are versioned, never edited. The date must be the 1st of a month.',
    method: 'POST', path: `/admin/users/${saraId}/salaries`, token: admin.access, expect: 201,
    body: { amount: 13500, effectiveFrom: '2027-01-01' },
  });
  await call({
    title: 'Open one employee',
    why: 'Now shows the full salary history, newest first.',
    method: 'GET', path: `/admin/users/${saraId}`, token: admin.access, expect: 200,
  });

  // ---------------------------------------------------------------- B2. one-time password
  md.push('### Part B2: The one-time password (first sign-in of an account an Admin created)', '');
  const firstLogin = await call({
    title: 'Sara signs in with the password the Admin gave her',
    why: 'An account created by an Admin (or the first Admin of a company, created by provisioning) starts with `mustChangePassword: true`.',
    method: 'POST', path: '/auth/login', expect: 200, body: { email: `sara-${run}@acme.test`, password: PASSWORD },
  });
  const saraAccess = firstLogin.json.accessToken as string;
  await call({
    title: 'Everything else is blocked until she changes it',
    why: 'Only `GET /auth/me`, logout and `PATCH /me/password` work. Other routes answer **403** with the machine-readable `code: PASSWORD_CHANGE_REQUIRED`.',
    method: 'GET', path: '/me/profile', token: saraAccess, expect: 403,
  });
  await call({
    title: 'Change the password',
    why: 'The new password must differ from the current one (8+ characters). All sessions end, so she signs in again. Wrong current passwords are rate-limited.',
    method: 'PATCH', path: '/me/password', token: saraAccess, expect: 200,
    body: { currentPassword: PASSWORD, newPassword: 'BrandNew#Pass9' },
  });
  const saraNew = await call({
    title: 'Sign in with the new password',
    why: '`mustChangePassword` is now false and her routes work again.',
    method: 'POST', path: '/auth/login', expect: 200, body: { email: `sara-${run}@acme.test`, password: 'BrandNew#Pass9' },
  });

  // ---------------------------------------------------------------- C. invitations
  md.push('### Part C: Invite an employee, then sign in as them', '');
  const inviteEmail = `newhire-${run}@acme.test`;
  const invite = await call({
    title: 'Invite',
    why: 'The response contains the one-time `token` ONCE. Only its hash is stored. The Admin shares the token with the invitee.',
    method: 'POST', path: '/admin/invitations', token: admin.access, expect: 201,
    body: { email: inviteEmail, fullName: 'New Hire', employeeCode: `INV-${run}` },
  });
  await call({
    title: 'List invitations',
    why: 'Shows status `PENDING`, `ACCEPTED`, `REVOKED` or `EXPIRED`. Tokens are never listed.',
    method: 'GET', path: '/admin/invitations', token: admin.access, expect: 200,
  });
  await call({
    title: 'Same email again',
    why: 'Only one pending invitation per email is allowed.',
    method: 'POST', path: '/admin/invitations', token: admin.access, expect: 409,
    body: { email: inviteEmail, fullName: 'New Hire', employeeCode: `INV-OTHER-${run}` },
  });
  await call({
    title: 'The invitee redeems the token (public route, no Authorization header)',
    why: 'Creates the account inside the inviter\'s company with the EMPLOYEE role. No tokens are issued here.',
    method: 'POST', path: '/auth/invitations/accept', expect: 200,
    body: { token: invite.json.token, password: PASSWORD },
  });
  await call({
    title: 'The same token again',
    why: 'Single-use: a used, expired, revoked or unknown token all give the same 400.',
    method: 'POST', path: '/auth/invitations/accept', expect: 400,
    body: { token: invite.json.token, password: PASSWORD },
  });
  const emp = await call({
    title: 'Sign in as the new employee',
    why: 'Same endpoint as the Admin. The role in the response is `EMPLOYEE`.',
    method: 'POST', path: '/auth/login', expect: 200, body: { email: inviteEmail, password: PASSWORD },
  });
  const e = { access: emp.json.accessToken as string, refresh: emp.json.refreshToken as string };

  await call({
    title: 'Employee reads their own profile',
    why: 'The record is chosen only by the token. There is no id to change.',
    method: 'GET', path: '/me/profile', token: e.access, expect: 200,
  });
  await call({
    title: 'Employee tries an ADMIN route',
    why: 'Authenticated but not allowed: **403**.',
    method: 'GET', path: '/admin/users', token: e.access, expect: 403,
  });
  await call({
    title: 'Employee tries an ADMIN mutation',
    why: 'Every ADMIN-only mutation rejects employees the same way.',
    method: 'POST', path: '/admin/users', token: e.access, expect: 403,
    body: { email: `x-${run}@acme.test`, fullName: 'X', employeeCode: `X-${run}`, password: PASSWORD, roleCode: 'ADMIN' },
  });

  // ---------------------------------------------------------------- D. sessions
  md.push('### Part D: Tokens, refresh and theft detection', '');
  const refreshed = await call({
    title: 'Refresh',
    why: 'Returns a NEW pair. The refresh token you sent is now spent: replace both stored tokens.',
    method: 'POST', path: '/auth/refresh', expect: 200, body: { refreshToken: e.refresh },
  });
  await call({
    title: 'Replay the spent refresh token (a stolen copy)',
    why: 'Reuse is treated as theft: the whole session family is revoked and this returns 401.',
    method: 'POST', path: '/auth/refresh', expect: 401, body: { refreshToken: e.refresh },
  });
  await call({
    title: 'The legitimate newer token is dead too',
    why: 'Because the family was revoked, the user must sign in again. This is the intended safety behaviour.',
    method: 'POST', path: '/auth/refresh', expect: 401, body: { refreshToken: refreshed.json.refreshToken },
  });
  const again = await call({
    title: 'Sign in again, then sign out',
    why: 'Sign-in works as before.',
    method: 'POST', path: '/auth/login', expect: 200, body: { email: inviteEmail, password: PASSWORD },
  });
  await call({
    title: 'Logout',
    why: 'Revokes the whole session. The access token keeps working until it expires (up to 15 minutes).',
    method: 'POST', path: '/auth/logout', expect: 200, body: { refreshToken: again.json.refreshToken },
  });
  await call({
    title: 'Refresh after logout',
    why: 'Refreshing a signed-out session fails.',
    method: 'POST', path: '/auth/refresh', expect: 401, body: { refreshToken: again.json.refreshToken },
  });

  // ---------------------------------------------------------------- E. deactivate
  md.push('### Part E: Deactivate and revoke', '');
  const revokeMe = await call({
    title: 'Invite someone, then change your mind',
    why: 'Create another invitation to revoke.',
    method: 'POST', path: '/admin/invitations', token: admin.access, expect: 201,
    body: { email: `revoked-${run}@acme.test`, fullName: 'Revoked Person', employeeCode: `REV-${run}` },
  });
  await call({
    title: 'Revoke the invitation',
    why: 'Its token stops working immediately.',
    method: 'DELETE', path: `/admin/invitations/${revokeMe.json.id}`, token: admin.access, expect: 200,
  });
  await call({
    title: 'Try to redeem the revoked token',
    why: 'Same generic 400 as any invalid token.',
    method: 'POST', path: '/auth/invitations/accept', expect: 400, body: { token: revokeMe.json.token, password: PASSWORD },
  });
  const hire = await prisma.user.findUniqueOrThrow({ where: { email: inviteEmail } });
  await call({
    title: 'Deactivate the new employee',
    why: 'Revokes all their refresh tokens immediately and stops absences from being recorded.',
    method: 'PATCH', path: `/admin/users/${hire.id}/status`, token: admin.access, expect: 200, body: { active: false },
  });
  await call({
    title: 'A deactivated user cannot sign in',
    why: 'The account is refused at login.',
    method: 'POST', path: '/auth/login', expect: 401, body: { email: inviteEmail, password: PASSWORD },
  });
  await call({
    title: 'Their old access token stops working immediately',
    why: 'The token was still within its 15 minutes, but every request checks that the account is active, so it is refused at once.',
    method: 'GET', path: '/auth/me', token: e.access, expect: 401,
  });

  // ---------------------------------------------------------------- E2. audit log
  md.push('### Part E2: The audit log', '');
  await call({
    title: 'Who did what? (newest first)',
    why: 'Every admin mutation and security event is recorded with the actor, the target and what changed, in the same transaction as the change. Passwords, hashes and tokens never appear.',
    method: 'GET', path: '/admin/audit-events?limit=4', token: admin.access, expect: 200,
  });
  await call({
    title: 'Filter by action and target',
    why: 'For example the deactivation of one user. `changes` shows before and after.',
    method: 'GET', path: `/admin/audit-events?action=user.deactivate&targetId=${hire.id}`, token: admin.access, expect: 200,
  });
  await call({
    title: 'An employee cannot read the log',
    why: 'It needs the `audit.read` permission, which only ADMIN has: **403**.',
    method: 'GET', path: '/admin/audit-events', token: saraNew.json.accessToken, expect: 403,
  });

  // ---------------------------------------------------------------- F. company isolation
  md.push('### Part F: Company isolation (two companies)', '');
  await provisionCompany(prisma, {
    name: `Beta ${run}`, slug: `beta-${run}`, adminEmail: `admin-beta-${run}@beta.test`,
    adminPassword: PASSWORD, employeeNumber: 'ADMIN-001',
    mustChangePassword: false, // this Admin has already replaced the one-time password (see Part B2)
  });
  const b = await call({
    title: 'Sign in as the Admin of a second company',
    why: 'A second company exists (created by the operator provisioning command, never over HTTP). This Admin\'s token carries a different `companyId`.',
    method: 'POST', path: '/auth/login', expect: 200, body: { email: `admin-beta-${run}@beta.test`, password: PASSWORD },
  });
  await call({
    title: 'Read a user of the OTHER company',
    why: 'Answered exactly like an id that does not exist: **404**. Nothing reveals that the record exists.',
    method: 'GET', path: `/admin/users/${saraId}`, token: b.json.accessToken, expect: 404,
  });
  await call({
    title: 'Change a user of the OTHER company',
    why: 'Also 404, and nothing is changed.',
    method: 'PATCH', path: `/admin/users/${saraId}/status`, token: b.json.accessToken, expect: 404, body: { active: false },
  });

  // ---------------------------------------------------------------- G. errors
  md.push('### Part G: Common errors', '');
  await call({
    title: 'No token',
    why: 'Every protected route needs a token: **401**.',
    method: 'GET', path: '/admin/users', expect: 401,
  });
  await call({
    title: 'Wrong password',
    why: 'Same message as an unknown email, so accounts cannot be probed.',
    method: 'POST', path: '/auth/login', expect: 401, body: { email: a.email, password: 'wrong-password' },
  });
  await call({
    title: 'Invalid body',
    why: 'Validation errors list every problem; unknown fields are rejected too.',
    method: 'POST', path: '/auth/login', expect: 400, body: { email: 'not-an-email', password: '123', extra: true },
  });
  await call({
    title: 'Duplicate employee code',
    why: 'Employee codes are unique within a company: **409**.',
    method: 'POST', path: '/admin/users', token: admin.access, expect: 409,
    body: { email: `dup-${run}@acme.test`, fullName: 'Dup', employeeCode: code, password: PASSWORD, roleCode: 'EMPLOYEE' },
  });
  let last = 0;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `throttle-${run}@acme.test`, password: 'wrong-password' }),
    });
    last = res.status;
  }
  stepNo += 1;
  if (last !== 429) failures.push(`Throttle: expected 429, got ${last}`);
  md.push(`### Step ${stepNo}. Too many login attempts`, '', 'More than 5 attempts per minute for one IP and email returns **429**. (The first five answered 401; the sixth:)', '', '```http', `POST /api/auth/login   (6th attempt in one minute)`, '```', '', `**Response ${last}**`, '', '```json', '{ "statusCode": 429, "message": "Too many login attempts. Please try again in 60 seconds." }', '```', '');

  await prisma.$disconnect();

  // ---------------------------------------------------------------- assemble
  const spec = JSON.parse(readFileSync(join(ROOT, 'docs', 'api', 'openapi.json'), 'utf-8'));
  const rows: string[] = [];
  for (const [path, item] of Object.entries<any>(spec.paths)) {
    for (const [method, op] of Object.entries<any>(item)) {
      rows.push(`| \`${method.toUpperCase()}\` | \`${path}\` | ${op.security ? 'Bearer token' : '**Public**'} | ${op.summary} |`);
    }
  }

  const head = `# 10 - API Testing Guide (end to end)

> **Generated by \`npm run docs:guide\`** from a real run of the API (${new Date().toISOString().slice(0, 10)}). Do not edit by hand: change the code, then re-run it. It fails if any step returns an unexpected status, so it is also a smoke test.

This guide shows the whole life of the API: sign in, manage employees, invite people, refresh tokens, deactivate, and prove that companies cannot see each other. Every step shows the request body and the real response.

## 1. Set up (5 minutes)

\`\`\`bash
docker compose up -d postgres          # PostgreSQL (on a machine with a native PostgreSQL, map the port to 5433)
cd apps/api
npx prisma migrate deploy && npx prisma db seed
npm run start                          # API on http://localhost:4000/api
\`\`\`

| What | Where |
|---|---|
| Interactive docs (try routes in the browser) | http://localhost:4000/api/docs |
| OpenAPI file for Apidog / Postman | http://localhost:4000/api/docs-json  or  \`docs/api/openapi.json\` |
| Development Admin (from the seed) | \`admin@checkpoint.local\` / \`AdminPassword123!\` |

**Test with:** Swagger UI (click **Authorize**, paste the \`accessToken\`), Apidog, Postman, or \`curl\`.

## 2. Five ideas you need

1. **Two tokens.** Login returns an \`accessToken\` (15 minutes, send it as \`Authorization: Bearer ...\`) and a \`refreshToken\` (30 days, single-use, exchanged at \`/auth/refresh\`).
2. **Roles.** \`ADMIN\` may call \`/admin/*\`. \`EMPLOYEE\` gets **403** there and may call \`/me/*\`. An account that still has a one-time password gets **403 \`PASSWORD_CHANGE_REQUIRED\`** everywhere until it calls \`PATCH /me/password\`.
3. **Company scope.** Your company is inside your token. You never send it. Another company's record answers **404**, exactly like a missing one.
4. **Errors** always look like \`{ "statusCode": 404, "message": "...", "error": "Not Found" }\`. A 400 lists every validation problem and rejects unknown fields.
5. **Money** is EGP, and amounts come back as strings (\`"12000"\`).

`;

  const tail = `## 4. Every route at a glance

| Method | Path | Needs | What it does |
|---|---|---|---|
${rows.join('\n')}

## 5. Status codes you will meet

| Code | Meaning here |
|---|---|
| 200 / 201 | Done |
| 400 | Invalid body, or an invalid/used/expired invitation token |
| 401 | No/expired token, wrong credentials, deactivated account, or a refresh token that is spent |
| 403 | Signed in, but your role lacks the permission |
| 404 | Not in **your** company (or does not exist) |
| 409 | Duplicate (email, employee code, pending invitation) or wrong state |
| 429 | Too many WRONG login, invitation or password attempts (successful sign-ins never count) |

## 6. Import into Apidog (or Postman / Insomnia)

1. Start the API, or just use the file \`docs/api/openapi.json\`.
2. **Apidog:** *Project settings → Import data → OpenAPI/Swagger →* choose the file, **or** paste the URL \`http://localhost:4000/api/docs-json\` (re-import it any time to refresh).
3. Create an environment variable \`baseUrl = http://localhost:4000\` and a variable \`accessToken\`. Set the project's auth to *Bearer Token* = \`{{accessToken}}\`.
4. Run **POST /api/auth/login**, copy \`accessToken\` into the variable, then run any route.
5. The request bodies already contain working examples; the schemas list every field with its type and example.

## 7. Keeping the docs current (for developers)

- Every route needs \`@ApiOperation\` (with a scenario), \`@ApiTags\`, and response decorators. Request and response bodies are classes with \`@ApiProperty\`.
- After adding or changing a route run **\`npm run docs:openapi\`** (rewrites \`docs/api/openapi.json\`) and **\`npm run docs:guide\`** (rewrites this file).
- The unit test \`src/swagger.spec.ts\` **fails** if \`docs/api/openapi.json\` is out of date or a route has no summary, tag or response, so CI catches a forgotten update.
`;

  const out = join(ROOT, 'docs', '10-API_TESTING_GUIDE.md');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, head + md.join('\n') + '\n' + tail, 'utf-8');

  if (failures.length) {
    console.error(`❌ ${failures.length} step(s) failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`✅ ${stepNo} steps passed. Guide written to docs/10-API_TESTING_GUIDE.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
