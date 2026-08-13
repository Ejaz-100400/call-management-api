import { IsIn, IsString } from 'class-validator';

export class CreateBusinessNumberDto {
  @IsString()
  phoneNumber: string;

  @IsIn(['car_glasses', 'car_modifications'])
  category: 'car_glasses' | 'car_modifications';

  @IsString()
  label: string;
}
