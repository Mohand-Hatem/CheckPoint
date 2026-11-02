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

@Controller('admin')
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get('point-values')
  @RequirePermission('points.read')
  getPointValues(@CurrentUser() admin: AuthenticatedUser) {
    return this.points.getPointValues(admin.companyId);
  }

  @Post('point-values')
  @RequirePermission('settings.write')
  configurePointValues(
    @Body() dto: ConfigurePointValuesDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.points.configurePointValues(admin.companyId, admin.userId, dto);
  }

  @Get('points')
  @RequirePermission('points.read')
  listPointEntries(
    @Query() query: ListPointEntriesQueryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.points.listPointEntries(admin.companyId, query);
  }

  @Post('points')
  @RequirePermission('points.write')
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
