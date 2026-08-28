import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QuerySalesDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'], { each: true })
  branch?: ('ambattur' | 'kattankulathur' | 'sithalapakkam' | 'pondicherry')[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['call', 'whatsapp', 'walk_in', 'owner', 'dastagir', 'karthik', 'referral', 'unknown'], { each: true })
  source?: ('call' | 'whatsapp' | 'walk_in' | 'owner' | 'dastagir' | 'karthik' | 'referral' | 'unknown')[];

  @IsOptional()
  @IsString()
  phone?: string;

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
