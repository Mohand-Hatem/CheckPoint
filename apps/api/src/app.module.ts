import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './auth/guards/csrf.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { InvitationsModule } from './invitations/invitations.module';
import { PasswordChangeRequiredGuard } from './auth/guards/password-change.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { AppLoggerModule } from './logger/logger.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { EmployeesModule } from './employees/employees.module';
import { FileMailTransport, MailModule } from '@nestjs/mail';
import { MailFeatureModule } from './mail/mail.module';

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
    EmployeesModule,
    MailFeatureModule,
    MailModule.forRoot({
      transport: new FileMailTransport({
        directory: 'var/mail',
      }),
      from: 'CheckPoint <noreply@example.com>',
    }),
    InvitationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
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
