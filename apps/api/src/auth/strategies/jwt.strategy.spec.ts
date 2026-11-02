import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const payload = { sub: 'user-1', companyId: 'company-1', email: 'a@acme.test', role: 'ADMIN', permissions: ['users.read'] };
  let prisma: any;
  let strategy: JwtStrategy;

  // null means "variable not set" (a default parameter would swallow undefined)
  const build = (secret: string | null = 'test-secret') =>
    new JwtStrategy({ get: jest.fn().mockReturnValue(secret ?? undefined) } as any, prisma);

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    strategy = build();
  });

  it('refuses to start without JWT_ACCESS_SECRET (no built-in fallback)', () => {
    expect(() => build(null)).toThrow('JWT_ACCESS_SECRET is not set');
  });

  it('returns the session, with mustChangePassword read from the database', async () => {
    prisma.user.findUnique.mockResolvedValue({ isActive: true, companyId: 'company-1', mustChangePassword: true });

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'user-1',
      companyId: 'company-1',
      email: 'a@acme.test',
      role: 'ADMIN',
      permissions: ['users.read'],
      mustChangePassword: true,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { isActive: true, companyId: true, mustChangePassword: true },
    });
  });

  it.each([
    ['a missing companyId', { ...payload, companyId: '' }, null],
    ['an unknown account', payload, null],
    ['a deactivated account', payload, { isActive: false, companyId: 'company-1', mustChangePassword: false }],
    ['a token company that is not the account company', payload, { isActive: true, companyId: 'company-OTHER', mustChangePassword: false }],
  ])('rejects %s', async (_name, tokenPayload, account) => {
    prisma.user.findUnique.mockResolvedValue(account);
    await expect(strategy.validate(tokenPayload as any)).rejects.toThrow(UnauthorizedException);
  });
});
