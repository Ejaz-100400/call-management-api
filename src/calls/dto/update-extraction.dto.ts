import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateExtractionDto {
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() carMake?: string;
  @IsOptional() @IsString() carModel?: string;
  @IsOptional() @IsString() carVariant?: string;
  @IsOptional() @IsString() customerRequirements?: string;
  @IsOptional() @IsNumber() budget?: number;
  @IsOptional() @IsBoolean() followUpRequired?: boolean;
  @IsOptional() @IsDateString() followUpDate?: string;
  @IsOptional() @IsString() summary?: string;

  @IsOptional()
  @IsIn(['interested', 'not_interested', 'needs_follow_up'])
  sentiment?: 'interested' | 'not_interested' | 'needs_follow_up';
}
