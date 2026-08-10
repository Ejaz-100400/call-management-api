import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class QueryCallsDto {
  @IsOptional()
  @IsString()
  search?: string; // free-text: matches customer name or AI summary

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  carMake?: string;

  @IsOptional()
  @IsString()
  carModel?: string;

  @IsOptional()
  @IsIn(['interested', 'not_interested', 'needs_follow_up'])
  sentiment?: 'interested' | 'not_interested' | 'needs_follow_up';

  // Query params arrive as strings -- 'true'/'false' rather than a real
  // boolean -- so the service parses this itself instead of using @Type(Boolean),
  // which would coerce any non-empty string (including "false") to true.
  @IsOptional()
  @IsIn(['true', 'false'])
  followUpRequired?: 'true' | 'false';

  @IsOptional()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'])
  category?: 'car_glasses' | 'car_modifications' | 'unknown';

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

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
