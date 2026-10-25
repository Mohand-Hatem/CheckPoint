# 11. Provisioning runbook: creating a company and its first Admin

Status: approved by Mohand Hatem, 2026-10-25 (TASK-043, REQ-031, REQ-001). This is a technical prerequisite of the multi-company schema. It is not a self-service feature.

## Who may run it

Only the platform operator: a team member who already has access to the server and its database credentials. No HTTP route can create a company, and no company Admin can. The `PROVISIONING_SECRET` guards against running the command by mistake. The real protection is that the command needs `DATABASE_URL`, which only the operator has.

## How the first Admin gets a password

1. The operator runs the command (below). It generates a random password and prints it once.
2. The operator hands it to the new Admin over a private channel. The system sends no email and no invitation.
3. The Admin signs in. Every route except `GET /me` and `PATCH /me/password` answers `403 PASSWORD_CHANGE_REQUIRED` until the Admin sets their own password.

The operator never chooses the password, so it never lands in shell history. The password is never written to the audit log or any other log. If the command runs in a CI pipeline, its output is a log, so do not run it there.

## The command

```bash
cd apps/api
export PROVISIONING_SECRET='<16 or more characters>'
npm run -s provision:company -- --secret "$PROVISIONING_SECRET" \
  --name "Acme" --slug acme --admin-email admin@acme.com [--admin-name "Ann"]
```

Keep the `-s`. Without it, npm prints the full command line, including the secret, into your terminal or log.

What one successful run creates, all in one database transaction: the company, its default settings, point values and shift, the first Admin user with the ADMIN role, an employee record for that Admin, and `companies.owner_user_id` pointing at that Admin. If any part fails, nothing is kept.

## Running it twice

Same slug and same Admin email: the command reports "already provisioned", changes nothing and prints no password. Same slug with a different email, or an email that already has an account in any company: the command refuses and says which one collided. Nothing is created.

## Lost one-time password

There is no reset option in the product. An operator resets it directly in the database, once the Admin confirms they have not yet changed it. From `apps/api`:

```bash
node -e "const a=require('argon2');a.hash(process.argv[1],{type:a.argon2id}).then(console.log)" '<new temporary password>'
```

Then, with the hash the command printed:

```sql
UPDATE users SET password_hash = '<hash>', must_change_password = true
WHERE email = 'admin@acme.com';
UPDATE refresh_tokens SET revoked_at = now()
WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE email = 'admin@acme.com');
```

Hand the temporary password to the Admin privately, as in the first run. A direct database change is not written to the audit log, so note it in your own operations record.

## Not included

Self-service signup, company invitations to join a platform, email delivery, a platform console and a reset command are not part of this task. Employee invitations inside a company are a separate feature (REQ-032).
