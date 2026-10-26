import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { BEARER, COOKIE } from './common/api-docs';

const DESCRIPTION = `
Attendance, points and incentive payroll for companies. Every company's data is isolated.

## Quick start (2 minutes)
1. **Sign in:** \`POST /api/auth/login\` with the development admin \`admin@checkpoint.local\` / \`AdminPassword123!\` (created by \`npx prisma db seed\`).
2. **Authorize:** click **Authorize** (top right) and paste the \`accessToken\`. It is valid 15 minutes.
3. **Try routes:** \`GET /api/auth/me\`, then \`POST /api/admin/users\`, \`POST /api/admin/invitations\`, and so on.
4. **Token expired (401)?** \`POST /api/auth/refresh\` with your \`refreshToken\`, and keep the NEW pair (refresh tokens are single-use).

The full step-by-step cycle with real request and response bodies is in \`docs/10-API_TESTING_GUIDE.md\`.

## Rules that apply everywhere
- **Authentication:** \`Authorization: Bearer <accessToken>\` (mobile, tools). Web clients send \`X-Auth-Mode: cookie\` on login, refresh and logout and get \`HttpOnly\` cookies instead; a write authenticated by cookie must also send \`X-CSRF-Token\`. When both a header and a cookie arrive, the header wins. Only login, refresh, logout and invitation accept are public.
- **Company scope:** your company comes from your token, never from the request. A record of another company answers **404**, the same as a missing one.
- **Roles:** ADMIN may use the \`/admin/*\` routes; EMPLOYEE gets **403** there. Employees reach only their own data (\`/me/*\`).
- **Validation:** unknown properties in a body are rejected with **400**.
- **Errors** always look like \`{ "statusCode": 404, "message": "...", "error": "Not Found" }\`.
- **Money** is EGP. Amounts come back as strings (for example \`"12000"\`).
`;

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('CheckPoint API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0.0')
    .addServer('http://localhost:4000', 'Local development')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Paste the accessToken from POST /api/auth/login' }, BEARER)
    .addCookieAuth('cp_access', { type: 'apiKey', in: 'cookie', name: 'cp_access', description: 'Web clients only: set by POST /api/auth/login with the header X-Auth-Mode: cookie' }, COOKIE)
    .addTag('Auth', 'Sign in, refresh, sign out, and redeem an invitation')
    .addTag('Me', 'The signed-in user\'s own data (any role)')
    .addTag('Admin · Users', 'Employees of the Admin\'s own company (ADMIN only)')
    .addTag('Admin · Invitations', 'Invite employees into the Admin\'s own company (ADMIN only)')
    .build();

  // Only the tags declared with @ApiTags: no extra tag named after each controller class.
  return SwaggerModule.createDocument(app, config, { autoTagControllers: false });
}

/** Swagger UI at /api/docs; the importable OpenAPI file at /api/docs-json (Apidog, Postman, Insomnia). */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    yamlDocumentUrl: 'api/docs-yaml',
    swaggerOptions: { persistAuthorization: true },
  });
}

/** Enabled outside production, or when SWAGGER_ENABLED=true (spec NFR-004 proposal). */
export const swaggerEnabled = () => process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true';
