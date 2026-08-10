import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryCustomersDto {
  @IsOptional()
  @IsString()
  search?: string; // matches customer name

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  carMake?: string; // matches any of the customer's calls

  @IsOptional()
  @IsString()
  carModel?: string;

  @IsOptional()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'])
  category?: 'car_glasses' | 'car_modifications' | 'unknown';

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
