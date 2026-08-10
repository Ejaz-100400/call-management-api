import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(['admin', 'manager', 'viewer'])
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
