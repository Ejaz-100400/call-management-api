import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryStockItemsDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['car_glasses', 'car_modifications'], { each: true })
  category?: ('car_glasses' | 'car_modifications')[];

  // The Product catalog link -- "subcategory" in the UI (e.g. "LED Fog",
  // "5D Ring"), distinct from `category` (Car Glasses/Car Modifications).
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productId?: string[];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}
