import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InviteTeamMemberDto } from './dto/invite-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Creates the Supabase Auth account (via GoTrue's admin invite endpoint,
   * which emails the person a link to set their own password) and the
   * matching `users` row this app actually authorizes against -- so an
   * admin can onboard a teammate entirely from within the dashboard instead
   * of needing direct Supabase project access.
   */
  async invite(dto: InviteTeamMemberDto, invitedById: string) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new InternalServerErrorException('Team invites are not configured (missing Supabase service role key)');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('This email already has an account.');

    const inviteUrl = `${supabaseUrl}/auth/v1/invite?redirect_to=${encodeURIComponent(dto.redirectTo)}`;
    const res = await fetch(inviteUrl, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: dto.email, data: { name: dto.name } }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      const message = (body.msg ?? body.message ?? body.error_description) as string | undefined;
      if (res.status === 422 || /already registered|already exists/i.test(message ?? '')) {
        throw new ConflictException('This email already has a Supabase account.');
      }
      throw new BadRequestException(message ?? 'Failed to send invite');
    }

    const invited = (await res.json()) as { id: string };

    // Re-inviting an email that already has a pending (unconfirmed) Supabase
    // account is idempotent on Supabase's side -- it resends the email and
    // returns the SAME auth id rather than erroring. Upsert here so a retry
    // (e.g. after a dropped response) doesn't crash on a duplicate id.
    const user = await this.prisma.user.upsert({
      where: { id: invited.id },
      create: {
        id: invited.id,
        name: dto.name,
        email: dto.email,
        role: dto.role,
        active: true,
      },
      update: {
        name: dto.name,
        email: dto.email,
        role: dto.role,
        active: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: invitedById,
        action: 'invite_team_member',
        entity: 'users',
        entityId: user.id,
        details: { email: dto.email, role: dto.role },
      },
    });

    return user;
  }

  async update(id: string, dto: UpdateTeamMemberDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Team member ${id} not found`);
    return this.prisma.user.update({ where: { id }, data: dto });
  }
}
