import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class QueryReportsDto {
  @IsOptional()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'])
  category?: 'car_glasses' | 'car_modifications' | 'unknown';

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  carMake?: string;

  @IsOptional()
  @IsString()
  carModel?: string;

  @IsOptional()
  @IsIn(['interested', 'not_interested', 'needs_follow_up'])
  sentiment?: 'interested' | 'not_interested' | 'needs_follow_up';

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
