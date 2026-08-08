import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { BusinessCategory, SentimentType } from '@prisma/client';

export class CommitPhotoRowDto {
  @IsNotEmpty()
  @IsString()
  phoneNumber: string;

  @IsOptional()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'])
  businessCategory?: BusinessCategory;

  @IsOptional()
  @IsDateString()
  callDate?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  carMake?: string;

  @IsOptional()
  @IsString()
  carModel?: string;

  @IsOptional()
  @IsString()
  carVariant?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productsDiscussed?: string[];

  @IsOptional()
  @IsString()
  customerRequirements?: string;

  @IsOptional()
  @IsNumber()
  budget?: number;

  @IsOptional()
  @IsBoolean()
  followUpRequired?: boolean;

  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsIn(['interested', 'not_interested', 'needs_follow_up'])
  sentiment?: SentimentType;
}

export class CommitPhotoRowsDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CommitPhotoRowDto)
  rows: CommitPhotoRowDto[];
}
