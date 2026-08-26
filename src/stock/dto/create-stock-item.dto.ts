import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { STOCK_LOCATIONS, StockLocationValue } from '../stock-location.util';

class InitialStockEntryDto {
  @IsIn(STOCK_LOCATIONS)
  location: StockLocationValue;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateStockItemDto {
  // Either productId (name/category derived server-side from the linked
  // catalog product) or name+category (a custom item not in the catalog)
  // must be provided -- enforced in the service, since class-validator
  // can't express "one of these two shapes" cleanly.
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['car_glasses', 'car_modifications'])
  category?: 'car_glasses' | 'car_modifications';

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderThreshold?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InitialStockEntryDto)
  initialStock?: InitialStockEntryDto[];
}
