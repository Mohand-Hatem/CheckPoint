import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CompanyModule } from './company/company.module';
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
    CompanyModule,
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
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
