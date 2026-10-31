import { PrismaClient } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { provisionCompany } from './provision-company';

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i > -1 ? argv[i + 1] : undefined;
}

function secretsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The logic behind `npm run provision:company` (docs/11-PROVISIONING_RUNBOOK.md).
 * The secret is checked before anything touches the database, and the secret itself is never printed.
 */
export async function runProvisionCommand(
  argv: string[],
  env: NodeJS.ProcessEnv,
  prisma: PrismaClient,
  log: (line: string) => void,
): Promise<void> {
  const expected = env.PROVISIONING_SECRET;
  if (!expected || expected.length < 16) {
    throw new Error('PROVISIONING_SECRET must be set in the environment (at least 16 characters).');
  }
  if (!secretsMatch(arg(argv, '--secret') ?? '', expected)) {
    throw new Error('Wrong or missing --secret. Nothing was created.');
  }

  const result = await provisionCompany(prisma, {
    name: arg(argv, '--name') ?? '',
    slug: arg(argv, '--slug') ?? '',
    adminEmail: arg(argv, '--admin-email') ?? '',
    adminFullName: arg(argv, '--admin-name'),
  });

  if (result.alreadyProvisioned) {
    log(`ℹ️  Already provisioned: company ${result.companyId}, first Admin ${result.adminEmail}. Nothing changed.`);
    return;
  }
  log(`✅ Company created: ${result.companyId}`);
  log(`✅ First Admin: ${result.adminEmail}`);
  if (result.generatedAdminPassword) {
    log(`🔑 One-time password (shown once, must be changed): ${result.generatedAdminPassword}`);
  }
}
