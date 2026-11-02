import { corsOptions, csrfTokenFor, extractAccessToken, readCookie } from './auth-transport';

const req = (headers: Record<string, string>) => ({ headers }) as any;

describe('readCookie', () => {
  it('reads one cookie out of the Cookie header', () => {
    expect(readCookie(req({ cookie: 'a=1; cp_access=abc.def.ghi; b=2' }), 'cp_access')).toBe('abc.def.ghi');
  });

  it('keeps "=" characters inside the value', () => {
    expect(readCookie(req({ cookie: 'cp_refresh=x=y==' }), 'cp_refresh')).toBe('x=y==');
  });

  it('returns undefined when the cookie or the header is missing', () => {
    expect(readCookie(req({ cookie: 'a=1' }), 'cp_access')).toBeUndefined();
    expect(readCookie(req({}), 'cp_access')).toBeUndefined();
  });
});

describe('extractAccessToken', () => {
  it('prefers the Authorization header and marks the source as header', () => {
    const r = req({ authorization: 'Bearer from-header', cookie: 'cp_access=from-cookie' });
    expect(extractAccessToken(r)).toBe('from-header');
    expect(r.authSource).toBe('header');
  });

  it('falls back to the cp_access cookie and marks the source as cookie', () => {
    const r = req({ cookie: 'cp_access=from-cookie' });
    expect(extractAccessToken(r)).toBe('from-cookie');
    expect(r.authSource).toBe('cookie');
  });

  it('returns null when neither is present', () => {
    expect(extractAccessToken(req({}))).toBeNull();
  });
});

describe('csrfTokenFor', () => {
  it('is stable for the same access token and secret', () => {
    expect(csrfTokenFor('token-1', 'secret')).toBe(csrfTokenFor('token-1', 'secret'));
  });

  it('differs per access token and per secret', () => {
    expect(csrfTokenFor('token-1', 'secret')).not.toBe(csrfTokenFor('token-2', 'secret'));
    expect(csrfTokenFor('token-1', 'secret')).not.toBe(csrfTokenFor('token-1', 'other'));
  });
});

describe('corsOptions', () => {
  it('allows only the listed origins, with credentials', () => {
    const o = corsOptions({ CORS_ORIGINS: 'https://app.acme.com, https://admin.acme.com' } as any);
    expect(o.origin).toEqual(['https://app.acme.com', 'https://admin.acme.com']);
    expect(o.credentials).toBe(true);
  });

  it('defaults to the local Next.js dev server outside production', () => {
    expect(corsOptions({ NODE_ENV: 'development' } as any).origin).toEqual(['http://localhost:3000']);
  });

  it('allows no browser origin in production when nothing is configured', () => {
    expect(corsOptions({ NODE_ENV: 'production' } as any).origin).toEqual([]);
  });
});
