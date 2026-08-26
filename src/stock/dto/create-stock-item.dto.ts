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
  // The catalog product this item's subcategory rolls up under -- purely a
  // grouping/link, never overrides the name below (e.g. subcategory "Fog
  // Projector" might hold several distinctly-named stock items).
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  name: string;

  @IsIn(['car_glasses', 'car_modifications'])
  category: 'car_glasses' | 'car_modifications';

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
