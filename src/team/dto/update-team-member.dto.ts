import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsIn(['admin', 'manager', 'viewer'])
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
