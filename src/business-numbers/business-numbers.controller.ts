import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { BusinessNumbersService } from './business-numbers.service';
import { CreateBusinessNumberDto } from './dto/create-business-number.dto';
import { UpdateBusinessNumberDto } from './dto/update-business-number.dto';

@Controller('business-numbers')
export class BusinessNumbersController {
  constructor(private readonly businessNumbersService: BusinessNumbersService) {}

  @Get()
  findAll() {
    return this.businessNumbersService.findAll();
  }

  // Admin-only: getting this wrong silently mis-tags every call that comes
  // in on the affected number, so it's kept tighter than most settings.
  @Post()
  @Roles('admin')
  create(@Body() dto: CreateBusinessNumberDto) {
    return this.businessNumbersService.create(dto);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBusinessNumberDto) {
    return this.businessNumbersService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.businessNumbersService.remove(id);
  }
}
