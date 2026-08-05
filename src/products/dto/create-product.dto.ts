import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsIn(['car_glasses', 'car_modifications'])
  category: 'car_glasses' | 'car_modifications';

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
