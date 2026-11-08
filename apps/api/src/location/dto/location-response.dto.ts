import { ApiProperty } from "@nestjs/swagger";

export class LocationResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Main Office" })
  name!: string;

  @ApiProperty({ example: 30.0444 })
  latitude!: number;

  @ApiProperty({ example: 31.2357 })
  longitude!: number;

  @ApiProperty({ example: 50 })
  radiusMeters!: number;

  @ApiProperty({
    example: false,
    description: "The location is deactivated; its row and assignments remain.",
  })
  active!: boolean;
}
