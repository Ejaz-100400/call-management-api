import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateBusinessNumberDto {
  @IsString()
  phoneNumber: string;

  @IsOptional()
  @IsString()
  exophoneNumber?: string;

  @IsIn(['car_glasses', 'car_modifications'])
  category: 'car_glasses' | 'car_modifications';

  @IsString()
  label: string;
}
