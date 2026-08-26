import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

// Deliberately narrower than create: which item, which location, and which
// direction (in/out) are the movement's identity -- if those are wrong, the
// fix is to delete it and log a new one, not "edit" it into a different
// movement. Only the correctable details are editable here.
export class UpdateStockMovementDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsDateString()
  movementDate?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
