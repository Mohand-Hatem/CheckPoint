import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PasswordChangeRequiredGuard } from './password-change.guard';

describe('PasswordChangeRequiredGuard', () => {
  const ctx = (user: unknown) =>
    ({ getHandler: () => 'h', getClass: () => 'c', switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
  const guardWith = (allowed: boolean) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(allowed) } as unknown as Reflector;
    return new PasswordChangeRequiredGuard(reflector);
  };

  it('lets public routes through (no user on the request)', () => {
    expect(guardWith(false).canActivate(ctx(undefined))).toBe(true);
  });

  it('lets a normal user through', () => {
    expect(guardWith(false).canActivate(ctx({ mustChangePassword: false }))).toBe(true);
  });

  it('lets a blocked user reach routes marked @AllowPasswordChange', () => {
    expect(guardWith(true).canActivate(ctx({ mustChangePassword: true }))).toBe(true);
  });

  it('blocks a user who must change the password everywhere else, with a machine-readable code', () => {
    let thrown: unknown;
    try {
      guardWith(false).canActivate(ctx({ mustChangePassword: true }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).getResponse()).toEqual(
      expect.objectContaining({ statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED' }),
    );
  });
});
