import { Module } from '@nestjs/common';
import { NoStockController } from './no-stock.controller';
import { NoStockService } from './no-stock.service';

@Module({
  controllers: [NoStockController],
  providers: [NoStockService],
})
export class NoStockModule {}
