import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListAuditEventsQuery {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 'user.create', description: 'Exact action, for example user.deactivate' })
  @IsOptional() @IsString()
  action?: string;

  @ApiPropertyOptional({ example: 'user', description: 'user, invitation or company' })
  @IsOptional() @IsString()
  targetType?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Id of the record the event is about' })
  @IsOptional() @IsUUID()
  targetId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Id of the user who did it' })
  @IsOptional() @IsUUID()
  actorUserId?: string;
}

export class AuditEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2026-10-25T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Who did it; null for system events' })
  actorUserId!: string | null;

  @ApiProperty({ example: 'ADMIN', enum: ['ADMIN', 'EMPLOYEE', 'SYSTEM'], nullable: true })
  actorType!: string | null;

  @ApiProperty({ example: 'user.deactivate' })
  action!: string;

  @ApiProperty({ example: 'user' })
  targetType!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  targetId!: string | null;

  @ApiProperty({ nullable: true, example: null })
  reason!: string | null;

  @ApiProperty({ example: { isActive: { from: true, to: false } }, description: 'What changed. Never contains passwords or tokens.' })
  changes!: Record<string, unknown>;
}

export class AuditEventListResponseDto {
  @ApiProperty({ type: [AuditEventDto] })
  data!: AuditEventDto[];

  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;
}
