import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LogTransport, MailerModule } from '@nestjs-modules/mailer';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CompanyModule } from './company/company.module';
import { EmployeesModule } from './employees/employees.module';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { AppLoggerModule } from './logger/logger.module';
import { PrismaModule } from './prisma/prisma.module';
import { PointsModule } from './points/points.module';
import { SchedulesModule } from './schedules/schedules.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AppLoggerModule,
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: config.get('SMTP_HOST')
          ? {
              host: config.get<string>('SMTP_HOST'),
              port: Number(config.get('SMTP_PORT', 587)),
              auth: { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') },
            }
          : // No SMTP: log mails instead; the body (with invite links) only outside production.
            new LogTransport({ body: config.get('NODE_ENV') !== 'production' }),
        defaults: { from: config.get('MAIL_FROM', 'CheckPoint <no-reply@checkpoint.local>') },
        sendTimeout: 10_000,
      }),
    }),
    PrismaModule,
    AuditModule,
    CompanyModule,
    AuthModule,
    EmployeesModule,
    UsersModule,
    PointsModule,
    SchedulesModule,
    AttendanceModule,
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
