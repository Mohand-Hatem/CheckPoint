import { PrismaService } from '../prisma/prisma.service';
import { CompanyPolicyService } from './company-policy.service';

describe('CompanyPolicyService.getGpsMaxAccuracyM', () => {
  const service = (value: unknown) =>
    new CompanyPolicyService({
      setting: { findUnique: jest.fn().mockResolvedValue(value === undefined ? null : { value }) },
    } as unknown as PrismaService);

  it("reads the company's gps_max_accuracy_m setting", async () => {
    await expect(service(25).getGpsMaxAccuracyM('company-1')).resolves.toBe(25);
  });

  it('falls back to 50 m when the setting is missing or not a number', async () => {
    await expect(service(undefined).getGpsMaxAccuracyM('company-1')).resolves.toBe(50);
    await expect(service('25').getGpsMaxAccuracyM('company-1')).resolves.toBe(50);
  });
});
