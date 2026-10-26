import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { createHmac } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import { ExtractJwt } from 'passport-jwt';

// Web clients ask for cookie mode; everyone else keeps tokens in the body and the Authorization header (docs/05 §3a).
export const AUTH_MODE_HEADER = 'x-auth-mode';
export const CSRF_HEADER = 'x-csrf-token';
export const ACCESS_COOKIE = 'cp_access';
export const REFRESH_COOKIE = 'cp_refresh';

export type AuthSource = 'header' | 'cookie';
export type RequestWithSource = Request & { authSource?: AuthSource };

export const isCookieMode = (req: Request) => req.headers[AUTH_MODE_HEADER] === 'cookie';

export function readCookie(req: Pick<Request, 'headers'>, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** passport-jwt extractor: the Authorization header wins, then the access cookie. Records which one was used. */
export function extractAccessToken(req: RequestWithSource): string | null {
  const bearer = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (bearer) {
    req.authSource = 'header';
    return bearer;
  }
  const cookie = readCookie(req, ACCESS_COOKIE);
  if (cookie) {
    req.authSource = 'cookie';
    return cookie;
  }
  return null;
}

/** Bound to one access token, so a token stolen from an old session is useless. Returned only in response bodies. */
export function csrfTokenFor(accessToken: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${accessToken}`).digest('base64url');
}

// shortcut: Secure only in production because Safari rejects Secure cookies on http://localhost; always serve production over HTTPS.
const cookieBase = (env: NodeJS.ProcessEnv): CookieOptions => ({ httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production' });

function secondsLeft(jwt: string): number {
  const { exp } = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf-8'));
  return Math.max(exp - Math.floor(Date.now() / 1000), 0);
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
  refreshDays: number,
  env: NodeJS.ProcessEnv = process.env,
) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...cookieBase(env), path: '/api', maxAge: secondsLeft(tokens.accessToken) * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...cookieBase(env), path: '/api/auth', maxAge: refreshDays * 86_400_000 });
}

export function clearAuthCookies(res: Response, env: NodeJS.ProcessEnv = process.env) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(env), path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(env), path: '/api/auth' });
}

/** Browsers may call the API only from CORS_ORIGINS (comma separated). Mobile apps and tools are not subject to CORS. */
export function corsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const configured = (env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const origin = configured.length ? configured : env.NODE_ENV === 'production' ? [] : ['http://localhost:3000'];
  return {
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Auth-Mode', 'X-CSRF-Token'],
  };
}
