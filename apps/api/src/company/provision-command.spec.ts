import { PrismaClient } from '@prisma/client';
import { runProvisionCommand } from './provision-command';
import { provisionCompany } from './provision-company';

jest.mock('./provision-company');

const SECRET = 'operator-secret-1234';
const prisma = {} as PrismaClient;
const base = ['--name', 'Acme', '--slug', 'acme', '--admin-email', 'admin@acme.com'];
const provision = provisionCompany as jest.MockedFunction<typeof provisionCompany>;

describe('runProvisionCommand', () => {
  let lines: string[];
  const log = (line: string) => lines.push(line);

  beforeEach(() => {
    lines = [];
    provision.mockReset();
  });

  it('refuses when PROVISIONING_SECRET is missing or shorter than 16 characters', async () => {
    await expect(runProvisionCommand(['--secret', 'x', ...base], {}, prisma, log)).rejects.toThrow(/PROVISIONING_SECRET/);
    await expect(
      runProvisionCommand(['--secret', 'short', ...base], { PROVISIONING_SECRET: 'short' }, prisma, log),
    ).rejects.toThrow(/PROVISIONING_SECRET/);
    expect(provision).not.toHaveBeenCalled();
  });

  it('refuses a wrong or missing --secret and creates nothing', async () => {
    const env = { PROVISIONING_SECRET: SECRET };
    await expect(runProvisionCommand(['--secret', 'wrong-secret-value-1', ...base], env, prisma, log)).rejects.toThrow(
      /Nothing was created/,
    );
    await expect(runProvisionCommand(base, env, prisma, log)).rejects.toThrow(/Nothing was created/);
    expect(provision).not.toHaveBeenCalled();
  });

  it('prints the generated one-time password exactly once and never the secret', async () => {
    provision.mockResolvedValue({
      companyId: 'c1',
      adminUserId: 'u1',
      adminEmail: 'admin@acme.com',
      generatedAdminPassword: 'one-time-pw',
      alreadyProvisioned: false,
    });
    await runProvisionCommand(['--secret', SECRET, ...base], { PROVISIONING_SECRET: SECRET }, prisma, log);

    expect(lines.filter((l) => l.includes('one-time-pw'))).toHaveLength(1);
    expect(lines.join('\n')).not.toContain(SECRET);
    expect(provision).toHaveBeenCalledWith(prisma, expect.objectContaining({ slug: 'acme', adminEmail: 'admin@acme.com' }));
  });

  it('says "already provisioned" on a retry and prints no password', async () => {
    provision.mockResolvedValue({ companyId: 'c1', adminUserId: 'u1', adminEmail: 'admin@acme.com', alreadyProvisioned: true });
    await runProvisionCommand(['--secret', SECRET, ...base], { PROVISIONING_SECRET: SECRET }, prisma, log);

    expect(lines.join('\n')).toMatch(/already provisioned/i);
    expect(lines.join('\n')).not.toMatch(/password/i);
  });
});
