import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
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

  // Which box this item lives in at the Warehouse -- free text since boxes
  // aren't a separate catalog (e.g. "Box 5" or "B12").
  @IsOptional()
  @IsString()
  boxNumber?: string;

  // Cost/purchase price -- internal tracking only. Nullable (not just
  // optional) so an edit can explicitly clear a previously-set price, same
  // "the frontend always sends this field" pattern as boxNumber.
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number | null;

  // Free-form spec fields whose relevance depends on the product type (e.g.
  // LED: watts/temperature/version) -- which fields apply is decided by the
  // frontend, not validated here beyond "it's an object".
  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InitialStockEntryDto)
  initialStock?: InitialStockEntryDto[];
}
