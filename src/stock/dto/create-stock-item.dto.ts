import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateStockItemDto {
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
}
