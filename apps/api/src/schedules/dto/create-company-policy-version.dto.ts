import { IsDateString, IsNotEmpty, IsString } from 'class-validator';

export class CreateCompanyPolicyVersionDto {
  @IsString()
  @IsNotEmpty()
  timezone!: string;

  @IsDateString({ strict: true })
  effectiveFrom!: string;
}
