/**
 * Operator-only: creates a company, its default configuration and its first Admin (spec REQ-031).
 * Never exposed over HTTP. See docs/11-PROVISIONING_RUNBOOK.md.
 *
 *   PROVISIONING_SECRET=<16+ chars> npm run provision:company -- \
 *     --secret <same value> --name "Acme" --slug acme --admin-email admin@acme.com [--admin-name "Ann"]
 */
import { PrismaClient } from '@prisma/client';
import { runProvisionCommand } from '../src/company/provision-command';

async function main() {
  const prisma = new PrismaClient();
  try {
    await runProvisionCommand(process.argv, process.env, prisma, console.log);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`❌ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
