import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { InvitationsModule } from './invitations/invitations.module';
import { PasswordChangeRequiredGuard } from './auth/guards/password-change.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { AppLoggerModule } from './logger/logger.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AppLoggerModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    InvitationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PasswordChangeRequiredGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
