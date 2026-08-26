import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateStockMovementDto {
  @IsUUID()
  stockItemId: string;

  @IsIn(['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'])
  branch: 'ambattur' | 'kattankulathur' | 'sithalapakkam' | 'pondicherry';

  @IsIn(['in', 'out'])
  type: 'in' | 'out';

  @IsInt()
  @Min(1)
  quantity: number;

  @IsDateString()
  movementDate: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
