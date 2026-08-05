import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class QueryCallsDto {
  @IsOptional()
  @IsString()
  search?: string; // free-text: matches customer name or AI summary

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  carModel?: string;

  @IsOptional()
  @IsIn(['car_glasses', 'car_modifications'])
  category?: 'car_glasses' | 'car_modifications';

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
