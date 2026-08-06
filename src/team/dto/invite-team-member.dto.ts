import { IsEmail, IsIn, IsString, IsUrl } from 'class-validator';
import { UserRole } from '@prisma/client';

export class InviteTeamMemberDto {
  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsIn(['admin', 'manager', 'viewer'])
  role: UserRole;

  // Where Supabase's invite-link email should send them to finish setting a
  // password. The frontend passes its own origin (same pattern as the
  // Google OAuth redirectTo) rather than the backend hardcoding a URL.
  @IsUrl({ require_tld: false })
  redirectTo: string;
}
