import { ApiProperty } from '@nestjs/swagger';

/** Every error in the API uses this one shape (NestJS default). */
export class ErrorResponseDto {
  @ApiProperty({ example: 400, description: 'HTTP status code' })
  statusCode!: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['Must be a valid email address'],
    description: 'A message, or a list of validation messages (400)',
  })
  message!: string | string[];

  @ApiProperty({ example: 'PASSWORD_CHANGE_REQUIRED', required: false, description: 'Machine-readable code on some errors' })
  code?: string;

  @ApiProperty({ example: 'Bad Request', required: false, description: 'HTTP status text (absent on some errors)' })
  error?: string;
}
