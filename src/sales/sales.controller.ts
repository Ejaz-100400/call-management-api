import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateSaleDto } from './dto/create-sale.dto';
import { QueryConversionSummaryDto } from './dto/query-conversion-summary.dto';
import { QuerySalesDto } from './dto/query-sales.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  findAll(@Query() query: QuerySalesDto) {
    return this.salesService.findAll(query);
  }

  @Get('match')
  match(@Query('phone') phone: string) {
    return this.salesService.match(phone);
  }

  @Get('reminder-status')
  reminderStatus() {
    return this.salesService.reminderStatus();
  }

  @Get('conversion-summary')
  conversionSummary(@Query() query: QueryConversionSummaryDto) {
    return this.salesService.conversionSummary(query);
  }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateSaleDto, @CurrentUser() user: User) {
    return this.salesService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSaleDto) {
    return this.salesService.update(id, dto);
  }
}
