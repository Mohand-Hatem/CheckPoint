import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class ListAuditEventsQuery {
  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  // YYYY-MM-DD, inclusive
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Dates must use YYYY-MM-DD format.' })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Dates must use YYYY-MM-DD format.' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
