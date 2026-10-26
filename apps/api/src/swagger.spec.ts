import { readFileSync } from 'fs';
import { join } from 'path';
import { generateOpenApiDocument } from '../test/support/openapi-document';

const OPENAPI_FILE = join(__dirname, '..', '..', '..', 'docs', 'api', 'openapi.json');

describe('OpenAPI documentation', () => {
  let document: Awaited<ReturnType<typeof generateOpenApiDocument>>;

  beforeAll(async () => {
    document = await generateOpenApiDocument();
  }, 30000);

  it('docs/api/openapi.json is up to date with the controllers (run `npm run docs:openapi`)', () => {
    const committed = JSON.parse(readFileSync(OPENAPI_FILE, 'utf-8'));
    expect(JSON.parse(JSON.stringify(document))).toEqual(committed);
  });

  it('every route is documented: summary, tag and a success response', () => {
    const problems: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        const id = `${method.toUpperCase()} ${path}`;
        if (!op.summary) problems.push(`${id}: missing summary`);
        if (!op.tags?.length) problems.push(`${id}: missing tag`);
        if (!Object.keys(op.responses ?? {}).some((code) => code.startsWith('2'))) problems.push(`${id}: no 2xx response`);
        if (op.security && !op.responses?.['401']) problems.push(`${id}: protected but no 401 documented`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every protected route declares the bearer scheme and the public ones do not', () => {
    const publicRoutes = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/invitations/accept'];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        const isPublic = publicRoutes.includes(path) && method === 'post';
        expect({ route: `${method} ${path}`, secured: Boolean(op.security?.length) }).toEqual({
          route: `${method} ${path}`,
          secured: !isPublic,
        });
      }
    }
  });
});
