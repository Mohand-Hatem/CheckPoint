import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

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

export class CheckOutResponseDto {
  @ApiProperty({ example: '2026-11-08T15:00:00.000Z', description: 'Server time of the checkout.' })
  checkOutAt!: Date;

  @ApiProperty({ example: 1, description: 'Overtime GREEN points awarded (whole hours after the shift end).' })
  overtimeGreens!: number;
}
