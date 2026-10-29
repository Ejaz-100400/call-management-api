import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateNoStockRequestDto {
  @IsString()
  @MinLength(1)
  customerName: string;

  // Required -- the point of taking these down is to get back to the
  // customer when the item arrives.
  @IsString()
  @MinLength(1)
  customerPhone: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsString()
  @MinLength(1)
  itemName: string;

  @IsIn(['car_glasses', 'car_modifications'])
  category: 'car_glasses' | 'car_modifications';

  // A calendar date ("YYYY-MM-DD"), not an instant.
  @IsDateString()
  requestDate: string;
}
