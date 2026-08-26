import { IsArray, IsIn, IsOptional } from 'class-validator';
import { ToArray } from '../../common/array-query.util';
import { STOCK_LOCATIONS, StockLocationValue } from '../stock-location.util';

export class QueryStockOverviewDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(STOCK_LOCATIONS, { each: true })
  location?: StockLocationValue[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['car_glasses', 'car_modifications'], { each: true })
  category?: ('car_glasses' | 'car_modifications')[];
}
