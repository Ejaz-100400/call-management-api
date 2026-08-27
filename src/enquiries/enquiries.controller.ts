import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { QueryEnquiriesDto } from './dto/query-enquiries.dto';
import { UpdateEnquiryDto } from './dto/update-enquiry.dto';
import { EnquiriesService } from './enquiries.service';

@Controller('enquiries')
export class EnquiriesController {
  constructor(private readonly enquiriesService: EnquiriesService) {}

  @Get()
  findAll(@Query() query: QueryEnquiriesDto) {
    return this.enquiriesService.findAll(query);
  }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateEnquiryDto, @CurrentUser() user: User) {
    return this.enquiriesService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEnquiryDto) {
    return this.enquiriesService.update(id, dto);
  }
}
