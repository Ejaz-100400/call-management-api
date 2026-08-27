import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { STOCK_LOCATIONS, StockLocationValue } from '../stock-location.util';

// A swap happens where a product is actually installed in a customer's
// car -- a branch, never the Warehouse (which only holds unsold stock).
const SWAP_LOCATIONS = STOCK_LOCATIONS.filter((l) => l !== 'warehouse');

export class CreateStockSwapDto {
  @IsIn(SWAP_LOCATIONS)
  location: StockLocationValue;

  // The product coming back out of the customer's car -- goes back `in` to stock.
  @IsUUID()
  oldStockItemId: string;

  // The replacement product going into the car -- goes `out` of stock.
  @IsUUID()
  newStockItemId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsDateString()
  movementDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
