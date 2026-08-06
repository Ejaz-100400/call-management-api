import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { InviteTeamMemberDto } from './dto/invite-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { TeamService } from './team.service';

@Controller('team')
@Roles('admin')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  findAll() {
    return this.teamService.findAll();
  }

  @Post('invite')
  invite(@Body() dto: InviteTeamMemberDto, @CurrentUser() user: User) {
    return this.teamService.invite(dto, user.id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamMemberDto) {
    return this.teamService.update(id, dto);
  }
}
