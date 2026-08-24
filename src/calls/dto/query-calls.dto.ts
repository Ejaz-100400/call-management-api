import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryCallsDto {
  @IsOptional()
  @IsString()
  search?: string; // free-text: matches customer name or AI summary

  @IsOptional()
  @IsString()
  phone?: string;

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

  // Query params arrive as strings -- 'true'/'false' rather than a real
  // boolean -- so the service parses this itself instead of using @Type(Boolean),
  // which would coerce any non-empty string (including "false") to true.
  // Binary (yes/no/either), so it stays single-select -- multi-selecting both
  // values would just mean "no filter."
  @IsOptional()
  @IsIn(['true', 'false'])
  followUpRequired?: 'true' | 'false';

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'], { each: true })
  category?: ('car_glasses' | 'car_modifications' | 'unknown')[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(['pending', 'processing', 'completed', 'failed'], { each: true })
  status?: ('pending' | 'processing' | 'completed' | 'failed')[];

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

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'timeFrom must be in HH:mm 24-hour format' })
  timeFrom?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'timeTo must be in HH:mm 24-hour format' })
  timeTo?: string;

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsUUID(undefined, { each: true })
  employeeId?: string[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productId?: string[];

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
