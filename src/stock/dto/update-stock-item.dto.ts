import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { CreateStockItemDto } from './create-stock-item.dto';
import { STOCK_LOCATIONS, StockLocationValue } from '../stock-location.util';

class AddStockDto {
  @IsIn(STOCK_LOCATIONS)
  location: StockLocationValue;

  @IsInt()
  @Min(1)
  quantity: number;
}

// initialStock is create-only -- editing an item should never silently log
// another movement as a side effect of some unrelated field change.
// addStock is the deliberate exception: an explicit, opt-in "add N units at
// this location" the user fills in on purpose. It's also the *only* way to
// add more Warehouse stock to an item after creation -- Stock Movements
// blocks "stock in" there on purpose (see CreateStockMovementDto), so
// without this, a Warehouse item could never be restocked once created.
export class UpdateStockItemDto extends PartialType(OmitType(CreateStockItemDto, ['initialStock'] as const)) {
  @IsOptional()
  @ValidateNested()
  @Type(() => AddStockDto)
  addStock?: AddStockDto;
}
