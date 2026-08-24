import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryCustomersDto {
  @IsOptional()
  @IsString()
  search?: string; // matches customer name

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsString({ each: true })
  carMake?: string[]; // matches any of the customer's calls

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsString({ each: true })
  carModel?: string[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'], { each: true })
  category?: ('car_glasses' | 'car_modifications' | 'unknown')[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['pending', 'processing', 'completed', 'failed'], { each: true })
  status?: ('pending' | 'processing' | 'completed' | 'failed')[]; // matches any of the customer's calls

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productId?: string[]; // matches any of the customer's calls

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
