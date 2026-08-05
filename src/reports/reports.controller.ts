import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  summary() {
    return this.reportsService.summary();
  }

  @Get('calls-by-period')
  callsByPeriod(@Query('granularity') granularity?: 'daily' | 'weekly' | 'monthly') {
    return this.reportsService.callsByPeriod(granularity);
  }

  @Get('follow-ups')
  followUps() {
    return this.reportsService.followUpBreakdown();
  }

  @Get('top-car-models')
  topCarModels(@Query('limit') limit?: string) {
    return this.reportsService.topCarModels(limit ? Number(limit) : undefined);
  }

  @Get('top-products')
  topProducts(@Query('limit') limit?: string) {
    return this.reportsService.topProducts(limit ? Number(limit) : undefined);
  }
}
