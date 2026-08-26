import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { STOCK_LOCATIONS, StockLocationValue } from '../stock-location.util';

export class CreateStockMovementDto {
  @IsUUID()
  stockItemId: string;

  @IsIn(STOCK_LOCATIONS)
  location: StockLocationValue;

  @IsIn(['in', 'out'])
  type: 'in' | 'out';

  @IsInt()
  @Min(1)
  quantity: number;

  @IsDateString()
  movementDate: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
