import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PASSWORD_CHANGE_KEY } from '../decorators/allow-password-change.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * A user holding a one-time password (provisioned first Admin, or created by an Admin) may do nothing
 * except change it, until mustChangePassword is cleared. Public routes have no user and pass through.
 */
@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user?.mustChangePassword) {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }

    throw new ForbiddenException({
      statusCode: 403,
      message: 'You must change your password first: call PATCH /api/me/password',
      error: 'Forbidden',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
}
