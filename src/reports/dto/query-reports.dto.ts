import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export class QueryReportsDto {
  @IsOptional()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'])
  category?: 'car_glasses' | 'car_modifications' | 'unknown';

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
