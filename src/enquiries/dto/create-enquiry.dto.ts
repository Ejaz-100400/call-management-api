import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateEnquiryDto {
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  carMake?: string;

  @IsOptional()
  @IsString()
  carModel?: string;

  @IsIn(['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'])
  branch: 'ambattur' | 'kattankulathur' | 'sithalapakkam' | 'pondicherry';

  @IsDateString()
  enquiryDate: string;

  @IsOptional()
  @IsIn(['purchased', 'not_purchased', 'undecided'])
  outcome?: 'purchased' | 'not_purchased' | 'undecided';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
