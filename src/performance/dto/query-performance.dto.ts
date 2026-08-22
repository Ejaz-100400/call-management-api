import { IsOptional, Matches } from 'class-validator';

export class QueryPerformanceDto {
  // "YYYY-MM" -- defaults to the current IST month when omitted.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;
}
