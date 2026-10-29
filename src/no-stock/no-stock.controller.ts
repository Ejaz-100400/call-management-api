import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateNoStockRequestDto } from './dto/create-no-stock-request.dto';
import { QueryNoStockRequestsDto } from './dto/query-no-stock-requests.dto';
import { UpdateNoStockRequestDto } from './dto/update-no-stock-request.dto';
import { NoStockService } from './no-stock.service';

// Same split as appointments and enquiries: anyone signed in can see the
// list, only managers/admins can add, edit or delete.
@Controller('no-stock')
export class NoStockController {
  constructor(private readonly noStockService: NoStockService) {}

  @Get()
  findAll(@Query() query: QueryNoStockRequestsDto) {
    return this.noStockService.findAll(query);
  }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateNoStockRequestDto, @CurrentUser() user: User) {
    return this.noStockService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNoStockRequestDto) {
    return this.noStockService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.noStockService.remove(id);
  }
}
