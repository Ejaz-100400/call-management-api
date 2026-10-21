import { Type } from 'class-transformer';
import { AppointmentStatus, Branch } from '@prisma/client';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ToArray } from '../../common/array-query.util';

export class QueryAppointmentsDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(Object.values(AppointmentStatus), { each: true })
  status?: AppointmentStatus[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(Object.values(Branch), { each: true })
  branch?: Branch[];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  // Soonest-first for working through what's coming up; newest-first (the
  // default) for looking back over what already happened.
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

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
