import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BulkDeleteFollowUpsDto } from './dto/bulk-delete-follow-ups.dto';
import { FollowUpsService } from './follow-ups.service';
import { QueryFollowUpsDto } from './dto/query-follow-ups.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';

@Controller('follow-ups')
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  @Get()
  findAll(@Query() query: QueryFollowUpsDto) {
    return this.followUpsService.findAll(query);
  }

  @Get('counts')
  counts(@Query() query: QueryFollowUpsDto) {
    return this.followUpsService.counts(query);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFollowUpDto) {
    return this.followUpsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.followUpsService.remove(id, user.id);
  }

  @Post('bulk-delete')
  @Roles('admin')
  removeMany(@Body() dto: BulkDeleteFollowUpsDto, @CurrentUser() user: User) {
    return this.followUpsService.removeMany(dto.ids, user.id);
  }
}
