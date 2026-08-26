import { IsArray, IsDateString, IsIn, IsOptional } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryConversionSummaryDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'], { each: true })
  branch?: ('ambattur' | 'kattankulathur' | 'sithalapakkam' | 'pondicherry')[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
