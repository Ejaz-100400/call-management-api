import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryStockItemsDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['car_glasses', 'car_modifications'], { each: true })
  category?: ('car_glasses' | 'car_modifications')[];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}
