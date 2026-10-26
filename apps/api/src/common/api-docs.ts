import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from './dto/error-response.dto';

/** Name of the bearer scheme declared in swagger.ts. */
export const BEARER = 'access-token';
/** Name of the cookie scheme declared in swagger.ts (web clients). */
export const COOKIE = 'cookie-auth';

/** Route needs a valid access token (every route except those marked @Public). */
export const ApiProtected = () =>
  applyDecorators(
    ApiBearerAuth(BEARER),
    ApiCookieAuth(COOKIE),
    ApiUnauthorizedResponse({
      description: 'No token, an invalid token, or an expired access token (15 minutes).',
      type: ErrorResponseDto,
      example: { statusCode: 401, message: 'Unauthorized' },
    }),
  );

/** Route also needs a permission the caller may not have (e.g. an EMPLOYEE calling an ADMIN route). */
export const ApiNeedsPermission = (permission: string) =>
  ApiForbiddenResponse({
    description: `The caller is authenticated but lacks the \`${permission}\` permission (ADMIN has it, EMPLOYEE does not).`,
    type: ErrorResponseDto,
    example: { statusCode: 403, message: `Access denied: requires permission(s): ${permission}`, error: 'Forbidden' },
  });

/** Body or query failed validation. Unknown properties are rejected too. */
export const ApiValidationError = () =>
  ApiBadRequestResponse({
    description: 'The body or query failed validation. Unknown properties are rejected, not ignored.',
    type: ErrorResponseDto,
    example: { statusCode: 400, message: ['Must be a valid email address'], error: 'Bad Request' },
  });
