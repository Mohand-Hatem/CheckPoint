import { Module } from "@nestjs/common";
import { ConditionalModule, ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { LogTransport, MailerModule } from "@nestjs-modules/mailer";
import { AbsenceSweepQueueModule } from "./attendance/absence-sweep.queue";
import { AttendanceModule } from "./attendance/attendance.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { CsrfGuard } from "./auth/guards/csrf.guard";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { CompanyModule } from "./company/company.module";
import { EmployeesModule } from "./employees/employees.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { PasswordChangeRequiredGuard } from "./auth/guards/password-change.guard";
import { PermissionsGuard } from "./auth/guards/permissions.guard";
import { AppLoggerModule } from "./logger/logger.module";
import { PrismaModule } from "./prisma/prisma.module";
import { PointsModule } from "./points/points.module";
import { SchedulesModule } from "./schedules/schedules.module";
import { UsersModule } from "./users/users.module";
import { WorkOffersModule } from "./work-offers/work-offers.module";
import { LocationModule } from "./location/location.module";
import { CalendarModule } from "./calendar/calendar.module";
import { CheckModule } from "./checkOperations/check.module";
import { validateEnv } from "./config/validate-env";
import { HealthController } from "./health/health.controller";
import { ScheduleModule } from "@nestjs/schedule";
import { SalaryCalcuationModule } from "./salaryCalcuation/salaryCalculation.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
      validate: validateEnv,
    }),
    AppLoggerModule,
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: config.get("SMTP_HOST")
          ? {
              host: config.get<string>("SMTP_HOST"),
              port: Number(config.get("SMTP_PORT", 587)),
              auth: {
                user: config.get<string>("SMTP_USER"),
                pass: config.get<string>("SMTP_PASS"),
              },
            }
          : // No SMTP: log mails instead; the body (with invite links) only outside production.
            new LogTransport({ body: config.get("NODE_ENV") !== "production" }),
        defaults: {
          from: config.get(
            "MAIL_FROM",
            "CheckPoint <no-reply@checkpoint.local>",
          ),
        },
        sendTimeout: 10_000,
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    CompanyModule,
    AuthModule,
    EmployeesModule,
    UsersModule,
    PointsModule,
    SchedulesModule,
    AttendanceModule,
    InvitationsModule,
    WorkOffersModule,
    LocationModule,
    CheckModule,
    CalendarModule,
    SalaryCalcuationModule,
    // Absence sweeper (05 §12): needs Redis; off in jest so tests never sweep their own data.
    ConditionalModule.registerWhen(
      AbsenceSweepQueueModule,
      (env) => Boolean(env.REDIS_HOST) && env.NODE_ENV !== "test",
    ),
  ],
  controllers: [HealthController],
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
