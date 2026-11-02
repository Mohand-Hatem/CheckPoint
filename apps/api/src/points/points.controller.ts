import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiNeedsPermission, ApiProtected, ApiValidationError } from '../common/api-docs';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ConfigurePointValuesDto } from './dto/configure-point-values.dto';
import { CreatePointEntryDto } from './dto/create-point-entry.dto';
import { ListPointEntriesQueryDto } from './dto/list-point-entries-query.dto';
import { ReversePointEntryDto } from './dto/reverse-point-entry.dto';
import { PointsService } from './points.service';

@ApiTags('Admin · Points')
@Controller('admin')
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get('point-values')
  @RequirePermission('points.read')
  @ApiProtected()
  @ApiNeedsPermission('points.read')
  @ApiOperation({ summary: 'List point value versions (EGP)' })
  @ApiOkResponse({ description: 'Success' })
  getPointValues(@CurrentUser() admin: AuthenticatedUser) {
    return this.points.getPointValues(admin.companyId);
  }

  @Post('point-values')
  @RequirePermission('settings.write')
  @ApiProtected()
  @ApiNeedsPermission('settings.write')
  @ApiOperation({ summary: 'Set GREEN/RED/BLACK values from a date' })
  @ApiCreatedResponse({ description: 'Success' })
  @ApiValidationError()
  configurePointValues(
    @Body() dto: ConfigurePointValuesDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.points.configurePointValues(admin.companyId, admin.userId, dto);
  }

  @Get('points')
  @RequirePermission('points.read')
  @ApiProtected()
  @ApiNeedsPermission('points.read')
  @ApiOperation({ summary: 'List point ledger entries' })
  @ApiOkResponse({ description: 'Success' })
  listPointEntries(
    @Query() query: ListPointEntriesQueryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.points.listPointEntries(admin.companyId, query);
  }

  @Post('points')
  @RequirePermission('points.write')
  @ApiProtected()
  @ApiNeedsPermission('points.write')
  @ApiOperation({ summary: 'Add points manually (needs Idempotency-Key and a reason)' })
  @ApiCreatedResponse({ description: 'Success' })
  @ApiValidationError()
  addPointEntry(
    @Body() dto: CreatePointEntryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.points.addPointEntry(
      admin.companyId,
      admin.userId,
      dto,
      idempotencyKey,
    );
  }

  @Post('points/:id/reverse')
  @RequirePermission('points.adjust')
  @ApiProtected()
  @ApiNeedsPermission('points.adjust')
  @ApiOperation({ summary: 'Reverse an admin point entry with a reason' })
  @ApiCreatedResponse({ description: 'Success' })
  @ApiValidationError()
  reversePointEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePointEntryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.points.reversePointEntry(
      admin.companyId,
      admin.userId,
      id,
      dto,
    );
  }
}
