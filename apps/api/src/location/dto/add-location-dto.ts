import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from "class-validator";

export class CreateLocationDto {
  @ApiProperty({ example: "Main Office" })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 30.0444, minimum: -90, maximum: 90 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 31.2357, minimum: -180, maximum: 180 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ example: 50, minimum: 1, default: 50, description: "Geofence radius in meters." })
  @IsOptional()
  @IsInt()
  @Min(1)
  radiusMeters?: number;
}

export class SetUserLocationsDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    example: ["00000000-0000-4000-8000-000000000000"],
    description: "The complete new set; an empty list removes every assignment.",
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID("4", { each: true })
  locationIds!: string[];
}
