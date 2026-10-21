import { Branch, SaleSource } from '@prisma/client';
import { IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateAppointmentDto {
  @IsString()
  @MinLength(1)
  customerName: string;

  // Optional -- a booking can still be made without a number, it just won't
  // link to a customer's call history.
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  carMake?: string;

  @IsOptional()
  @IsString()
  carModel?: string;

  @IsIn(Object.values(Branch))
  branch: Branch;

  // Same list the Customer Tracker's sales use -- read straight from the
  // Prisma enum so a source added there shows up here without a second edit.
  @IsOptional()
  @IsIn(Object.values(SaleSource))
  source?: SaleSource;

  // A full instant (ISO 8601 with offset), not a date -- the frontend
  // builds it from an IST date + time, so it carries the +05:30.
  @IsDateString()
  appointmentAt: string;

  // Product ids from the catalog -- the light upgrade(s) they're coming for.
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productIds?: string[];
}
