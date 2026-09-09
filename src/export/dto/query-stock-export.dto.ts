import { IsArray, IsIn, IsOptional } from 'class-validator';
import { ToArray } from '../../common/array-query.util';
import { QueryStockItemsDto } from '../../stock/dto/query-stock-items.dto';
import { STOCK_LOCATIONS, StockLocationValue } from '../../stock/stock-location.util';

/**
 * Everything QueryStockItemsDto filters (which items are included) plus
 * `location`, which is export-only -- it doesn't change which items match,
 * it narrows which location columns the report renders. Unset/empty means
 * "all locations", same as every other multi-select filter in this app.
 */
export class QueryStockExportDto extends QueryStockItemsDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(STOCK_LOCATIONS, { each: true })
  location?: StockLocationValue[];
}
