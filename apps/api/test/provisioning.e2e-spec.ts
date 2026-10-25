/**
 * REQ-031 / TASK-043: bootstrap creates one company and its first Admin in a single transaction,
 * links the owner, assigns the Admin role inside that company, survives a retry without duplicates,
 * and never writes the password anywhere. Docs: docs/11-PROVISIONING_RUNBOOK.md.
 */
import { PrismaClient } from '@prisma/client';
import { provisionCompany } from '../src/company/provision-company';

const prisma = new PrismaClient();
const run = Date.now();

describe('Company provisioning (e2e)', () => {
  const slug = `prov-${run}`;
  const adminEmail = `Admin-${run}@Prov.Test`; // mixed case on purpose: stored lower-case
  let first: Awaited<ReturnType<typeof provisionCompany>>;

  afterAll(() => prisma.$disconnect());

  it('creates the company, the Admin, the owner link and the ADMIN role in one go', async () => {
    first = await provisionCompany(prisma, { name: `Prov ${run}`, slug, adminEmail });

    const company = await prisma.company.findUniqueOrThrow({ where: { slug } });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { id: first.adminUserId },
      include: { roles: { include: { role: true } }, employee: true },
    });

    expect(first.alreadyProvisioned).toBe(false);
    expect(company.ownerUserId).toBe(admin.id);
    expect(admin.companyId).toBe(company.id);
    expect(admin.email).toBe(adminEmail.toLowerCase());
    expect(admin.roles.map((ur) => ur.role.name)).toEqual(['ADMIN']);
    expect(admin.employee?.companyId).toBe(company.id);
    expect(admin.mustChangePassword).toBe(true);
    expect(first.generatedAdminPassword).toBeDefined();
    expect(admin.passwordHash).not.toContain(first.generatedAdminPassword!);
  });

  it('writes no password, hash or token into the audit event', async () => {
    const events = await prisma.auditEvent.findMany({ where: { companyId: first.companyId } });
    expect(events.map((e) => e.action)).toEqual(['company.provision']);

    const text = JSON.stringify(events);
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: first.adminUserId } });
    expect(text).not.toContain(first.generatedAdminPassword!);
    expect(text).not.toContain(admin.passwordHash);
    expect(text.toLowerCase()).not.toContain('password');
  });

  it('a retry with the same slug and email reports "already provisioned" and creates nothing', async () => {
    const counts = async () => ({
      companies: await prisma.company.count({ where: { slug } }),
      users: await prisma.user.count({ where: { companyId: first.companyId } }),
      settings: await prisma.setting.count({ where: { companyId: first.companyId } }),
      shifts: await prisma.shift.count({ where: { companyId: first.companyId } }),
      provisionEvents: await prisma.auditEvent.count({ where: { companyId: first.companyId, action: 'company.provision' } }),
    });
    const before = await counts();
    const hashBefore = (await prisma.user.findUniqueOrThrow({ where: { id: first.adminUserId } })).passwordHash;

    const retry = await provisionCompany(prisma, { name: `Prov ${run}`, slug, adminEmail });

    expect(retry.alreadyProvisioned).toBe(true);
    expect(retry.companyId).toBe(first.companyId);
    expect(retry.adminUserId).toBe(first.adminUserId);
    expect(retry.generatedAdminPassword).toBeUndefined();
    expect(await counts()).toEqual(before);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first.adminUserId } })).passwordHash).toBe(hashBefore);
  });

  it('the same slug with a different email is refused and says the slug is taken', async () => {
    await expect(provisionCompany(prisma, { name: 'Other', slug, adminEmail: `other-${run}@prov.test` })).rejects.toThrow(
      /slug.*already exists/i,
    );
    expect(await prisma.user.count({ where: { email: `other-${run}@prov.test` } })).toBe(0);
  });

  it('an email that already has an account elsewhere is refused and says the email is taken', async () => {
    await expect(provisionCompany(prisma, { name: 'Other', slug: `${slug}-b`, adminEmail })).rejects.toThrow(
      /email.*already exists/i,
    );
    expect(await prisma.company.count({ where: { slug: `${slug}-b` } })).toBe(0);
  });
});
