import { IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryReportsDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'], { each: true })
  category?: ('car_glasses' | 'car_modifications' | 'unknown')[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsUUID(undefined, { each: true })
  employeeId?: string[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'], { each: true })
  branch?: ('ambattur' | 'kattankulathur' | 'sithalapakkam' | 'pondicherry')[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsString({ each: true })
  carMake?: string[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsString({ each: true })
  carModel?: string[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['interested', 'not_interested', 'needs_follow_up'], { each: true })
  sentiment?: ('interested' | 'not_interested' | 'needs_follow_up')[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productId?: string[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
