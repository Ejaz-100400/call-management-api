import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { STOCK_LOCATIONS, StockLocationValue } from '../stock-location.util';

// "To" excludes warehouse -- warehouse never receives stock through
// Movements, only through the Stock Items screen (see the plain stock-in
// restriction on regular movements). "From" allows warehouse, since
// distributing warehouse stock out to a branch is exactly a transfer.
const TRANSFER_DESTINATIONS = STOCK_LOCATIONS.filter((l) => l !== 'warehouse');

export class CreateStockTransferDto {
  @IsUUID()
  stockItemId: string;

  @IsIn(STOCK_LOCATIONS)
  fromLocation: StockLocationValue;

  @IsIn(TRANSFER_DESTINATIONS)
  toLocation: StockLocationValue;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsDateString()
  movementDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
