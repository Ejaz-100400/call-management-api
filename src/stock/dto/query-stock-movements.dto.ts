import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryStockMovementsDto {
  @IsOptional()
  @IsUUID()
  stockItemId?: string;

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'], { each: true })
  branch?: ('ambattur' | 'kattankulathur' | 'sithalapakkam' | 'pondicherry')[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['in', 'out'], { each: true })
  type?: ('in' | 'out')[];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
