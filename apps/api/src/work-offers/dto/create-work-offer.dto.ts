import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  Matches,
  IsString,
  IsUUID,
  ValidateIf,
} from "class-validator";

export class CreateWorkOfferDto {
  @ApiProperty({ enum: ["EARLY_WORK", "OVERTIME"], example: "OVERTIME" })
  @IsIn(["EARLY_WORK", "OVERTIME"])
  offerType!: "EARLY_WORK" | "OVERTIME";

  @ApiProperty({ example: "2026-11-10T07:00:00Z", format: "date-time" })
  @IsDateString({ strict: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i,
  )
  startsAt!: string;

  @ApiProperty({ example: "2026-11-10T09:00:00Z", format: "date-time" })
  @IsDateString({ strict: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i,
  )
  endsAt!: string;

  @ApiProperty({ example: "Please arrive early to help with opening." })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({
    example: false,
    description:
      "When true, all current and future employees in the company can see this offer.",
  })
  @IsBoolean()
  allEmployees!: boolean;

  @ApiPropertyOptional({
    type: [String],
    format: "uuid",
    example: ["c0ffee00-0000-4000-8000-000000000003"],
  })
  @ValidateIf((dto: CreateWorkOfferDto) => !dto.allEmployees)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID("all", { each: true })
  employeeIds?: string[];
}
