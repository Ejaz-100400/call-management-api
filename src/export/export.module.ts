import { Module } from '@nestjs/common';
import { CallsModule } from '../calls/calls.module';
import { StockModule } from '../stock/stock.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [CallsModule, StockModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
