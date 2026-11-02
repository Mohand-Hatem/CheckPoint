import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { ACCESS_COOKIE, CSRF_HEADER, RequestWithSource, csrfTokenFor, readCookie } from '../auth-transport';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A browser attaches cookies by itself, so a write authenticated by the access COOKIE must also prove it came from our
 * page by echoing the csrfToken. Requests authenticated by the Authorization header are exempt: a cross-site page
 * cannot add that header. Runs after JwtAuthGuard, which records where the token came from.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithSource>();
    if (req.authSource !== 'cookie' || SAFE_METHODS.has(req.method)) return true;

    const accessToken = readCookie(req, ACCESS_COOKIE) ?? '';
    const expected = Buffer.from(csrfTokenFor(accessToken, this.config.getOrThrow<string>('JWT_ACCESS_SECRET')));
    const sent = Buffer.from(String(req.headers[CSRF_HEADER] ?? ''));
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'CSRF token missing or invalid. Send the csrfToken as X-CSRF-Token.',
        error: 'Forbidden',
        code: 'CSRF_TOKEN_INVALID',
      });
    }
    return true;
  }
}
