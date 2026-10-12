import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('CheckPoint End-to-End Tests (e2e)', () => {
  let app: INestApplication;
  let adminAccessToken: string;
  let adminRefreshToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Authentication Lifecycle (/api/auth)', () => {
    it('POST /api/auth/login - should reject invalid credentials (401)', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'admin@checkpoint.local',
          password: 'WrongPassword!',
        })
        .expect(401);
    });

    it('POST /api/auth/login - should authenticate admin and issue tokens (200)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'admin@checkpoint.local',
          password: 'AdminPassword123!',
        })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.user.email).toBe('admin@checkpoint.local');
      expect(response.body.user.role).toBe('ADMIN');

      adminAccessToken = response.body.accessToken;
      adminRefreshToken = response.body.refreshToken;
    });

    it('GET /api/auth/me - should reject unauthenticated request (401)', () => {
      return request(app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);
    });

    it('GET /api/auth/me - should return authenticated profile with valid token (200)', () => {
      return request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.email).toBe('admin@checkpoint.local');
          expect(res.body.role).toBe('ADMIN');
          expect(Array.isArray(res.body.permissions)).toBe(true);
        });
    });

    it('POST /api/auth/refresh - should rotate refresh token successfully (200)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: adminRefreshToken })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.refreshToken).not.toBe(adminRefreshToken);
    });

    it('POST /api/auth/refresh - should detect spent token reuse and revoke family (401)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: adminRefreshToken })
        .expect(401);

      expect(response.body.message).toContain('reuse detected');
    });
  });

  describe('User & Salary Management (/api/admin/users)', () => {
    let createdUserId: string;

    it('POST /api/admin/users - should create an employee user with initial salary (201)', async () => {
      const email = `e2e-user-${Date.now()}@checkpoint.local`;
      const response = await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          email,
          fullName: 'E2E Test Employee',
          password: 'Password123!',
          roleCode: 'EMPLOYEE',
          initialSalary: 11000,
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.email).toBe(email);
      createdUserId = response.body.id;
    });

    it('POST /api/admin/users/:id/salaries - should reject salary date not on 1st of month (400)', () => {
      return request(app.getHttpServer())
        .post(`/api/admin/users/${createdUserId}/salaries`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          amount: 13000,
          effectiveFrom: '2026-11-15',
        })
        .expect(400);
    });

    it('POST /api/admin/users/:id/salaries - should accept salary on 1st of month (201)', () => {
      return request(app.getHttpServer())
        .post(`/api/admin/users/${createdUserId}/salaries`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          amount: 13500,
          effectiveFrom: '2026-11-01',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.amount).toBe('13500');
        });
    });
  });
});
