import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import { AuditService } from './audit.service';
import { AuditEventListResponseDto, ListAuditEventsQuery } from './dto/audit.dto';

@ApiTags('Admin · Audit')
@Controller('admin/audit-events')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  @ApiProtected()
  @ApiNeedsPermission('audit.read')
  @ApiOperation({
    summary: 'Read the audit log of my company',
    description:
      '**Scenario:** an Admin asks "who did what?". Every admin mutation (create user, activate/deactivate, salary, invitations) and security event ' +
      '(password change, company provisioning) is recorded with who did it, which record it touched, and what changed. Newest first, paginated, filterable.\n\n' +
      '**Rules:** only your own company\'s events are ever returned. The log is append-only (the database refuses edits and deletes) and never contains passwords, hashes or tokens.',
  })
  @ApiOkResponse({ type: AuditEventListResponseDto })
  @ApiValidationError()
  list(@CurrentUser() admin: AuthenticatedUser, @Query() query: ListAuditEventsQuery) {
    return this.auditService.list(admin.companyId, query);
  }
}
