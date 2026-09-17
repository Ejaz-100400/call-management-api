import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryWhatsAppConversationsDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'], { each: true })
  category?: ('car_glasses' | 'car_modifications' | 'unknown')[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productId?: string[];

  @IsOptional()
  @IsString()
  search?: string;
}
