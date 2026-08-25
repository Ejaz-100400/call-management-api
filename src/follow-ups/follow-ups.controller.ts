import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
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
}
