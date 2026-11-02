import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReversePointEntryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
