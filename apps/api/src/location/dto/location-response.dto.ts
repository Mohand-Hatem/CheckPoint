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

export class QrTokenResponseDto {
  @ApiProperty({ example: "v1.00000000-0000-4000-8000-000000000000.59216880.Q2hlY2tQb2ludCBkZW1vIHNpZ25hdHVyZSBvbmx5Lg" })
  token!: string;

  @ApiProperty({ example: "2026-11-09T10:00:30.000Z", description: "Show a new token by this time; this one is still accepted for one more period." })
  validUntil!: Date;
}
