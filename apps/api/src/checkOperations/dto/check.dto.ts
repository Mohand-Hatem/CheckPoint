import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

// Body of check-in and check-out; time and overtime always come from the server.
export class PositionDto {
  @ApiProperty({ example: 30.0444, minimum: -90, maximum: 90, description: 'Latitude in degrees.' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 31.2357, minimum: -180, maximum: 180, description: 'Longitude in degrees.' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiProperty({
    example: 10,
    minimum: 0,
    description: "GPS accuracy radius in meters; must not exceed the company's gps_max_accuracy_m.",
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  accuracy!: number;
}

export class CheckInStartedResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Send this with the scanned QR token to confirm.' })
  verificationId!: string;

  @ApiProperty({ format: 'uuid', description: 'The location whose kiosk QR code must be scanned.' })
  locationId!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({ example: '2026-11-09T08:45:00.000Z', description: 'Scan the QR code before this time.' })
  expiresAt!: Date;
}

export class ConfirmCheckInDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  verificationId!: string;

  @ApiProperty({ example: 'v1.00000000-0000-4000-8000-000000000000.59216880.Q2hlY2tQb2ludCBkZW1vIHNpZ25hdHVyZSBvbmx5Lg' })
  @IsString()
  @MaxLength(200)
  qrToken!: string;
}

export class CheckOutResponseDto {
  @ApiProperty({ example: '2026-11-08T15:00:00.000Z', description: 'Server time of the checkout.' })
  checkOutAt!: Date;

  @ApiProperty({ example: 1, description: 'Overtime GREEN points awarded (whole hours after the shift end).' })
  overtimeGreens!: number;
}
