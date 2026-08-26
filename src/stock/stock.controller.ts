import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateStockItemDto } from './dto/create-stock-item.dto';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { QueryStockItemsDto } from './dto/query-stock-items.dto';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto';
import { QueryStockOverviewDto } from './dto/query-stock-overview.dto';
import { UpdateStockItemDto } from './dto/update-stock-item.dto';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('overview')
  overview(@Query() query: QueryStockOverviewDto) {
    return this.stockService.overview(query);
  }

  @Get('items')
  findAllItems(@Query() query: QueryStockItemsDto) {
    return this.stockService.findAllItems(query);
  }

  @Post('items')
  @Roles('admin', 'manager')
  createItem(@Body() dto: CreateStockItemDto, @CurrentUser() user: User) {
    return this.stockService.createItem(dto, user.id);
  }

  @Patch('items/:id')
  @Roles('admin', 'manager')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStockItemDto, @CurrentUser() user: User) {
    return this.stockService.updateItem(id, dto, user.id);
  }

  @Delete('items/:id')
  @Roles('admin')
  deleteItem(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.stockService.deleteItem(id, user.id);
  }

  @Get('movements')
  findAllMovements(@Query() query: QueryStockMovementsDto) {
    return this.stockService.findAllMovements(query);
  }

  @Post('movements')
  @Roles('admin', 'manager')
  createMovement(@Body() dto: CreateStockMovementDto, @CurrentUser() user: User) {
    return this.stockService.createMovement(dto, user.id);
  }

  @Delete('movements/:id')
  @Roles('admin', 'manager')
  deleteMovement(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.stockService.deleteMovement(id, user.id);
  }
}
