/**
 * Web clients use HttpOnly cookies, mobile and tools use the bearer header (docs/03 Authentication, docs/05 §3a).
 * One auth core, two transports: the header wins when both are sent, and only cookie-authenticated writes need a CSRF token.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { corsOptions } from '../src/auth/auth-transport';
import { provisionCompany } from '../src/company/provision-company';

const prisma = new PrismaClient();
const run = Date.now();
const PASSWORD = 'Password123!';
const WEB_ORIGIN = 'https://app.checkpoint.test';

describe('Cookie authentication (e2e)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer();
  const email = `cookie-admin-${run}@cookie.test`;

  const setCookies = (res: request.Response): string[] => (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const rawCookie = (res: request.Response, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`));
  const cookieValue = (res: request.Response, name: string) => rawCookie(res, name)?.split(';')[0].slice(name.length + 1);
  const cookieHeader = (access?: string, refresh?: string) =>
    [access && `cp_access=${access}`, refresh && `cp_refresh=${refresh}`].filter(Boolean).join('; ');

  const webLogin = () =>
    request(http()).post('/api/auth/login').set('X-Auth-Mode', 'cookie').send({ email, password: PASSWORD });

  let userSeq = 0;
  const newUserBody = () => {
    userSeq += 1;
    return { email: `emp${userSeq}-${run}@cookie.test`, fullName: 'Emp', employeeCode: `CK-${userSeq}`, password: PASSWORD, roleCode: 'EMPLOYEE' };
  };

  beforeAll(async () => {
    process.env.CORS_ORIGINS = WEB_ORIGIN;
    await provisionCompany(prisma, {
      name: `Cookie ${run}`, slug: `cookie-${run}`, adminEmail: email, adminPassword: PASSWORD, mustChangePassword: false,
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableCors(corsOptions(process.env));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  describe('login', () => {
    it('without the cookie header it still returns tokens in the body and sets no cookie (mobile, tools)', async () => {
      const res = await request(http()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(setCookies(res)).toHaveLength(0);
    });

    it('with X-Auth-Mode: cookie it sets two HttpOnly cookies and keeps the tokens out of the body', async () => {
      const res = await webLogin().expect(200);

      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();
      expect(res.body.csrfToken).toEqual(expect.any(String));
      expect(res.body.user.email).toBe(email);

      const access = rawCookie(res, 'cp_access')!;
      const refresh = rawCookie(res, 'cp_refresh')!;
      expect(access).toMatch(/HttpOnly/i);
      expect(access).toMatch(/SameSite=Lax/i);
      expect(access).toMatch(/Path=\/api(;|$)/);
      expect(refresh).toMatch(/HttpOnly/i);
      expect(refresh).toMatch(/SameSite=Lax/i);
      expect(refresh).toMatch(/Path=\/api\/auth(;|$)/);
    });
  });

  describe('using the access cookie', () => {
    it('GET /auth/me works with the cookie alone and returns the csrfToken', async () => {
      const login = await webLogin().expect(200);
      const me = await request(http()).get('/api/auth/me').set('Cookie', cookieHeader(cookieValue(login, 'cp_access'))).expect(200);

      expect(me.body.email).toBe(email);
      expect(me.body.csrfToken).toBe(login.body.csrfToken);
    });

    it('GET /auth/me with the header alone has no csrfToken', async () => {
      const login = await request(http()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
      const me = await request(http()).get('/api/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);

      expect(me.body.csrfToken).toBeUndefined();
    });

    it('the header wins: a bad bearer token is rejected even when a valid cookie is sent', async () => {
      const login = await webLogin().expect(200);
      await request(http())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .set('Cookie', cookieHeader(cookieValue(login, 'cp_access')))
        .expect(401);
    });
  });

  describe('CSRF protection for cookie-authenticated writes', () => {
    it('refuses a write with no X-CSRF-Token', async () => {
      const login = await webLogin().expect(200);
      const res = await request(http())
        .post('/api/admin/users')
        .set('Cookie', cookieHeader(cookieValue(login, 'cp_access')))
        .send(newUserBody())
        .expect(403);
      expect(res.body.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('refuses a write with a wrong X-CSRF-Token', async () => {
      const login = await webLogin().expect(200);
      await request(http())
        .post('/api/admin/users')
        .set('Cookie', cookieHeader(cookieValue(login, 'cp_access')))
        .set('X-CSRF-Token', 'wrong')
        .send(newUserBody())
        .expect(403);
    });

    it('accepts the write with the right X-CSRF-Token', async () => {
      const login = await webLogin().expect(200);
      await request(http())
        .post('/api/admin/users')
        .set('Cookie', cookieHeader(cookieValue(login, 'cp_access')))
        .set('X-CSRF-Token', login.body.csrfToken)
        .send(newUserBody())
        .expect(201);
    });

    it('does not ask for a token when the bearer header authenticated the request', async () => {
      const login = await request(http()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
      const cookieLogin = await webLogin().expect(200);
      await request(http())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .set('Cookie', cookieHeader(cookieValue(cookieLogin, 'cp_access'))) // a cookie is present too: the header still decides
        .send(newUserBody())
        .expect(201);
    });
  });

  describe('refresh and logout in cookie mode', () => {
    it('rotates both cookies, returns a new csrfToken and never puts tokens in the body', async () => {
      const login = await webLogin().expect(200);
      const res = await request(http())
        .post('/api/auth/refresh')
        .set('X-Auth-Mode', 'cookie')
        .set('Cookie', cookieHeader(undefined, cookieValue(login, 'cp_refresh')))
        .expect(200);

      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();
      expect(res.body.csrfToken).toEqual(expect.any(String));
      expect(cookieValue(res, 'cp_access')).toBeTruthy();
      expect(cookieValue(res, 'cp_refresh')).not.toBe(cookieValue(login, 'cp_refresh'));
    });

    it('a replayed refresh cookie is refused, clears the cookies and ends the whole session', async () => {
      const login = await webLogin().expect(200);
      const oldRefresh = cookieValue(login, 'cp_refresh');
      const rotated = await request(http())
        .post('/api/auth/refresh')
        .set('X-Auth-Mode', 'cookie')
        .set('Cookie', cookieHeader(undefined, oldRefresh))
        .expect(200);

      const replay = await request(http())
        .post('/api/auth/refresh')
        .set('X-Auth-Mode', 'cookie')
        .set('Cookie', cookieHeader(undefined, oldRefresh))
        .expect(401);
      expect(rawCookie(replay, 'cp_refresh')).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);

      await request(http())
        .post('/api/auth/refresh')
        .set('X-Auth-Mode', 'cookie')
        .set('Cookie', cookieHeader(undefined, cookieValue(rotated, 'cp_refresh')))
        .expect(401);
    });

    it('without X-Auth-Mode and without a body token the refresh is a 400, as before', async () => {
      const res = await request(http()).post('/api/auth/refresh').send({}).expect(400);
      expect(res.body.message).toEqual(['Refresh token is required']);
    });

    it('logout clears both cookies and the refresh cookie no longer works', async () => {
      const login = await webLogin().expect(200);
      const refresh = cookieValue(login, 'cp_refresh');
      const out = await request(http())
        .post('/api/auth/logout')
        .set('X-Auth-Mode', 'cookie')
        .set('Cookie', cookieHeader(cookieValue(login, 'cp_access'), refresh))
        .expect(200);

      expect(rawCookie(out, 'cp_access')).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
      expect(rawCookie(out, 'cp_refresh')).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
      await request(http())
        .post('/api/auth/refresh')
        .set('X-Auth-Mode', 'cookie')
        .set('Cookie', cookieHeader(undefined, refresh))
        .expect(401);
    });
  });

  describe('CORS', () => {
    it('answers a preflight from the configured web origin and allows credentials', async () => {
      const res = await request(http())
        .options('/api/auth/login')
        .set('Origin', WEB_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-auth-mode,x-csrf-token');

      expect(res.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-csrf-token');
    });

    it('gives an unknown origin no permission', async () => {
      const res = await request(http())
        .options('/api/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
