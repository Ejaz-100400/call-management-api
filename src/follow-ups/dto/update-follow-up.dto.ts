import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateFollowUpDto {
  @IsOptional()
  @IsIn(['pending', 'completed', 'missed'])
  status?: 'pending' | 'completed' | 'missed';

  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
