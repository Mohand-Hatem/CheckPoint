import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginThrottleGuard, LoginThrottleInterceptor } from './guards/login-throttle.guard';
import { LoginThrottleService } from './guards/login-throttle.service';
import { PermissionsGuard } from './guards/permissions.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN', '15m') || '15m') as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsGuard,
    LoginThrottleService,
    LoginThrottleGuard,
    LoginThrottleInterceptor,
  ],
  exports: [
    AuthService,
    JwtModule,
    JwtAuthGuard,
    PermissionsGuard,
    LoginThrottleService,
    LoginThrottleGuard,
    LoginThrottleInterceptor,
  ],
})
export class AuthModule {}
