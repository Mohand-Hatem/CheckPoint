import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditService } from './audit.service';
import { ListAuditEventsQuery } from './dto/list-audit-events.query';

@Controller('admin/audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@Query() query: ListAuditEventsQuery, @CurrentUser() admin: AuthenticatedUser) {
    return this.audit.list(admin.companyId, query);
  }
}

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
