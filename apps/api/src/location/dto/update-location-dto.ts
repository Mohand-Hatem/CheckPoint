import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

export class UpdateLocationDto {
  @ApiPropertyOptional({ example: "Main Office" })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ example: 30.0444, minimum: -90, maximum: 90 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 31.2357, minimum: -180, maximum: 180 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ example: 75, minimum: 1 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  radiusMeters?: number;

  @ApiPropertyOptional({
    example: true,
    description: "Set false to deactivate, or true to reactivate the location.",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}
