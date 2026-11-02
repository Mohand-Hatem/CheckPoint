/**
 * Rules the DATABASE itself must enforce (docs/08), independent of any service code.
 * Needs a database created by `prisma migrate deploy`; `db push` does not create these.
 */
import { PrismaClient } from '@prisma/client';
import { provisionCompany } from '../src/company/provision-company';

const prisma = new PrismaClient();
const run = Date.now();
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const clock = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const REJECTED = /constraint|violat|append-only/i;

describe('Database constraints', () => {
  let companyId: string;
  let adminUserId: string;
  let employeeId: string;
  let shiftId: string;

  beforeAll(async () => {
    const result = await provisionCompany(prisma, {
      name: `Constraints ${run}`, slug: `constraints-${run}`, adminEmail: `admin-${run}@db.test`,
      adminPassword: 'Password123!', mustChangePassword: false,
    });
    companyId = result.companyId;
    adminUserId = result.adminUserId;
    const employee = await prisma.employee.findFirstOrThrow({ where: { userId: adminUserId } });
    employeeId = employee.id;
    shiftId = employee.currentShiftId;
  }, 60000);

  afterAll(() => prisma.$disconnect());

  describe('invitations: one pending per company and email / employee code', () => {
    const invite = (email: string, number: string, status: 'PENDING' | 'REVOKED' = 'PENDING') =>
      prisma.companyInvitation.create({
        data: {
          companyId, invitedByUserId: adminUserId, email, fullName: 'X', employeeNumber: number, status,
          tokenHash: `${email}-${number}-${Math.random()}`, expiresAt: new Date(Date.now() + 1_000_000),
        },
      });

    it('rejects a second pending invitation for the same email', async () => {
      await invite(`dup-${run}@db.test`, `D-1-${run}`);
      await expect(invite(`dup-${run}@db.test`, `D-2-${run}`)).rejects.toThrow(REJECTED);
    });

    it('rejects a second pending invitation for the same employee code', async () => {
      await invite(`code-a-${run}@db.test`, `C-1-${run}`);
      await expect(invite(`code-b-${run}@db.test`, `C-1-${run}`)).rejects.toThrow(REJECTED);
    });

    it('allows a new pending invitation once the earlier one is no longer pending', async () => {
      await invite(`again-${run}@db.test`, `A-1-${run}`, 'REVOKED');
      await expect(invite(`again-${run}@db.test`, `A-1-${run}`)).resolves.toBeDefined();
    });
  });

  describe('identity', () => {
    it('stores emails in lower case only', async () => {
      await expect(
        prisma.user.create({ data: { companyId, email: `Upper-${run}@db.test`, passwordHash: 'x' } }),
      ).rejects.toThrow(REJECTED);
    });

    it('allows exactly one role per user in the MVP', async () => {
      const employeeRole = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
      await expect(prisma.userRole.create({ data: { userId: adminUserId, roleId: employeeRole.id } })).rejects.toThrow(REJECTED);
    });
  });

  describe('money and points', () => {
    it('rejects a zero or negative salary', async () => {
      await expect(
        prisma.employeeSalaryVersion.create({ data: { companyId, employeeId, salary: 0, effectiveFrom: day('2030-01-01') } }),
      ).rejects.toThrow(REJECTED);
    });

    it('rejects a point value of zero or less', async () => {
      await expect(
        prisma.pointValueVersion.create({ data: { companyId, pointType: 'GREEN', value: 0, effectiveFrom: day('2030-01-01') } }),
      ).rejects.toThrow(REJECTED);
    });

    it('never gives WHITE a money value', async () => {
      await expect(
        prisma.pointValueVersion.create({ data: { companyId, pointType: 'WHITE', value: 5, effectiveFrom: day('2030-01-01') } }),
      ).rejects.toThrow(REJECTED);
    });

    it('accepts a valid point value version', async () => {
      await expect(
        prisma.pointValueVersion.create({ data: { companyId, pointType: 'RED', value: 300, effectiveFrom: day('2030-01-01') } }),
      ).resolves.toBeDefined();
    });
  });

  describe('schedules', () => {
    const version = (early: number, grace: number, red: number) =>
      prisma.shiftVersion.create({
        data: {
          companyId, shiftId, startTime: clock('08:00'), endTime: clock('16:00'),
          earlyMinutes: early, graceMinutes: grace, redPeriodMinutes: red, effectiveFrom: day('2030-02-01'),
        },
      });

    it('requires early < grace < red-period windows', async () => {
      await expect(version(120, 60, 240)).rejects.toThrow(REJECTED);
      await expect(version(60, 60, 240)).rejects.toThrow(REJECTED);
    });

    it('accepts the confirmed windows 60 / 120 / 240', async () => {
      await expect(version(60, 120, 240)).resolves.toBeDefined();
    });

    it('rejects overlapping shift assignments for one employee, allows back-to-back ones', async () => {
      const assign = (from: string, to: string | null) =>
        prisma.shiftAssignment.create({
          data: { companyId, employeeId, shiftId, effectiveFrom: day(from), effectiveTo: to ? day(to) : null },
        });

      await assign('2031-01-01', '2031-01-31');
      await expect(assign('2031-01-15', '2031-02-15')).rejects.toThrow(REJECTED);
      await expect(assign('2031-01-31', '2031-02-10')).rejects.toThrow(REJECTED); // shares the last day
      await expect(assign('2031-02-01', '2031-02-28')).resolves.toBeDefined(); // back-to-back is fine
      await expect(assign('2031-02-20', null)).rejects.toThrow(REJECTED); // open-ended overlaps the one above
    });
  });
});
