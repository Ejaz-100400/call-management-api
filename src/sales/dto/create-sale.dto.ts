import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSaleDto {
  @IsString()
  customerPhone: string;

  @IsOptional()
  @IsString()
  carMake?: string;

  @IsOptional()
  @IsString()
  carModel?: string;

  @IsIn(['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'])
  branch: 'ambattur' | 'kattankulathur' | 'sithalapakkam' | 'pondicherry';

  @IsDateString()
  saleDate: string;

  @IsOptional()
  @IsIn(['call', 'whatsapp', 'walk_in', 'owner', 'dastagir', 'karthik', 'referral', 'unknown'])
  source?: 'call' | 'whatsapp' | 'walk_in' | 'owner' | 'dastagir' | 'karthik' | 'referral' | 'unknown';

  @IsOptional()
  @IsUUID()
  matchedCallId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
