import { ApiProperty } from "@nestjs/swagger";

export class WorkOfferResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: ["OFF_DAY_WORK", "EARLY_WORK", "OVERTIME"] })
  offerType!: string;

  @ApiProperty({ format: "date-time" })
  startsAt!: Date;

  @ApiProperty({ format: "date-time" })
  endsAt!: Date;

  @ApiProperty({ enum: ["ACTIVE", "COMPLETED", "CANCELLED"] })
  status!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  allEmployees!: boolean;

  @ApiProperty({ type: [String], format: "uuid" })
  employeeIds!: string[];

  @ApiProperty({ format: "uuid" })
  createdByUserId!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "uuid", nullable: true })
  cancelledByUserId!: string | null;

  @ApiProperty({ format: "date-time", nullable: true })
  cancelledAt!: Date | null;
}
