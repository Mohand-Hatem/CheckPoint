import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user || !user.permissions) {
      throw new ForbiddenException('Access denied: no permissions granted');
    }

    // Full system wildcard permission '*'
    if (user.permissions.includes('*')) {
      return true;
    }

    // Verify all required permissions are matched by user's permissions or domain wildcards
    const hasAllPermissions = requiredPermissions.every((required) =>
      user.permissions.some((userPerm) => {
        if (userPerm === required) {
          return true;
        }
        if (userPerm.endsWith('.*')) {
          const prefix = userPerm.slice(0, -2);
          return required.startsWith(`${prefix}.`);
        }
        return false;
      }),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException(
        `Access denied: requires permission(s): ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}
