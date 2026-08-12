import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { BusinessCategory } from '@prisma/client';

class ImportedRowSummaryDto {
  @IsUUID()
  callId: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsString()
  phoneNumber: string;

  @IsIn(['car_glasses', 'car_modifications', 'unknown'])
  businessCategory: BusinessCategory;

  @IsDateString()
  callDate: string;

  @IsOptional()
  @IsString()
  location?: string;
}

class ImportErrorDto {
  @IsInt()
  row: number;

  @IsString()
  reason: string;
}

export class RecordImportHistoryDto {
  @IsIn(['excel', 'photo_ocr', 'manual'])
  source: 'excel' | 'photo_ocr' | 'manual';

  @IsInt()
  @Min(0)
  imported: number;

  @IsInt()
  @Min(0)
  skipped: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportErrorDto)
  errors: ImportErrorDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportedRowSummaryDto)
  rows: ImportedRowSummaryDto[];
}
