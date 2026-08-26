import { IsArray, IsIn, IsOptional } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryStockOverviewDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'], { each: true })
  branch?: ('ambattur' | 'kattankulathur' | 'sithalapakkam' | 'pondicherry')[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['car_glasses', 'car_modifications'], { each: true })
  category?: ('car_glasses' | 'car_modifications')[];
}
